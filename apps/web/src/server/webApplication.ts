import { createHash, randomBytes } from "node:crypto";
import { dealFolderPath, renderApplicationPdf, type ApplicationPdfSection } from "@mca/connectors";
import { enqueueJob, type Prisma, type PrismaClient } from "@mca/db";
import {
  APPLICATION_TITLE,
  ASCEND_BRAND,
  READING_PLACEHOLDER,
  SIGNATURE_CONSENT,
  applicationFileBase,
  applicationSections,
  dealApplication,
  missingFields,
  signatureConsent,
} from "./ascendApplication";
import { storeDealFile } from "./documents";
import { tenantMailbox } from "./google";
import { nameMatches } from "./whatsapp/questions";

/**
 * The merchant's own application page (/application/<token>): the merchant uploads their
 * application and bank statements, checks the details the CRM filled in, and signs Ascend's
 * application by typing their name. The signed PDF lands on the deal, ticked for lenders.
 *
 * The link is the merchant's key, so only its SHA-256 is stored and it expires. A deal started
 * on the public page is never matched to an existing merchant here (a stranger typing a known
 * business name must not see that business's details); the team can merge records later.
 */

const DAY = 24 * 3_600_000;
/** How long a link works before it is signed. */
export const LINK_DAYS = 14;
/** After signing, the page still offers the merchant their copy for this long. */
const COPY_DAYS = 30;
/** Public page limits: per IP per hour, and for everyone per day. */
export const STARTS_PER_IP_HOUR = 5;
export const STARTS_PER_DAY = 100;

export type Lang = "en" | "es";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

export const ESIGN_AGREEMENT: Record<Lang, string> = {
  en: "I agree to sign this application electronically. I adopt the name I type below as my signature, and it has the same effect as my handwritten signature.",
  es: "Acepto firmar esta solicitud electrónicamente. Adopto el nombre que escribo abajo como mi firma, y tiene el mismo efecto que mi firma a mano.",
};

/** Spanish reading of the default authorization; the English text is the one on the PDF. */
const CONSENT_ES =
  "Al firmar, certifico que soy dueño del negocio nombrado en esta solicitud y que la información en ella y en los documentos entregados es verdadera, correcta y completa. Autorizo a Ascend Fund, sus agentes y los socios de financiamiento con quienes comparta esta solicitud a obtener reportes de crédito comerciales y personales, referencias bancarias y comerciales y otra información sobre el negocio y sus dueños, y a compartir esta solicitud y sus documentos con esos socios. Acepto que una firma electrónica en esta solicitud tiene el mismo efecto que una firma a mano.";

/** The first address in X-Forwarded-For (set by Caddy, the only way in), else nothing. */
export function clientIp(h: Headers): string | null {
  const first = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first && /^[0-9a-fA-F:.]{3,45}$/.test(first) ? first : null;
}

export async function createWebApplication(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    dealId: string;
    origin: "public" | "team";
    lang?: Lang;
    email?: string | null;
    phone?: string | null;
    ip?: string | null;
  },
  now = new Date(),
): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await prisma.webApplication.create({
    data: {
      tenantId: input.tenantId,
      dealId: input.dealId,
      hashedToken: hashToken(token),
      origin: input.origin,
      lang: input.lang ?? "en",
      email: input.email ?? null,
      phone: input.phone ?? null,
      createdByIp: input.ip ?? null,
      expiresAt: new Date(now.getTime() + LINK_DAYS * DAY),
    },
  });
  return token;
}

/** The link's row if it still works (not expired), else null. */
export async function findWebApplication(prisma: PrismaClient, token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const row = await prisma.webApplication.findUnique({
    where: { hashedToken: hashToken(token) },
  });
  if (!row || row.expiresAt <= now) return null;
  return row;
}

/** Whether the public page may start another application from this IP right now. */
export async function publicStartAllowed(
  prisma: PrismaClient,
  ip: string | null,
  now = new Date(),
): Promise<boolean> {
  const today = await prisma.webApplication.count({
    where: { origin: "public", createdAt: { gt: new Date(now.getTime() - DAY) } },
  });
  if (today >= STARTS_PER_DAY) return false;
  if (!ip) return true;
  const fromIp = await prisma.webApplication.count({
    where: { createdByIp: ip, createdAt: { gt: new Date(now.getTime() - 3_600_000) } },
  });
  return fromIp < STARTS_PER_IP_HOUR;
}

export interface UploadedFile {
  name: string;
  type: string;
  data: Buffer;
}

/**
 * Public start: a new deal with a placeholder merchant, the merchant's application (if any)
 * read by AI into it, and their statements filed. Returns the private link's token.
 */
export async function startPublicApplication(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    application: { fileName: string; data: Buffer } | null;
    statements: UploadedFile[];
    email: string;
    phone: string | null;
    lang: Lang;
    ip: string | null;
  },
): Promise<{ token: string; dealId: string; readJobId: string | null }> {
  const mailbox = await tenantMailbox(prisma, input.tenantId);
  const merchant = await prisma.merchant.create({
    data: { tenantId: input.tenantId, legalName: READING_PLACEHOLDER },
  });
  const deal = await prisma.deal.create({
    data: {
      tenantId: input.tenantId,
      merchantId: merchant.id,
      source: "web_apply",
      stage: input.statements.length ? "DOCS_RECEIVED" : "DOCS_REQUESTED",
    },
  });
  let readJobId: string | null = null;
  if (input.application) {
    const doc = await storeDealFile(prisma, mailbox, {
      tenantId: input.tenantId,
      dealId: deal.id,
      merchantId: merchant.id,
      file: {
        fileName: input.application.fileName,
        mimeType: "application/pdf",
        data: input.application.data,
      },
      type: "APPLICATION",
      uploadedVia: "website",
      autoProcess: false,
    });
    // Another company's form: kept for the team, never packaged for a lender.
    await prisma.document.update({ where: { id: doc.id }, data: { internalOnly: true } });
    readJobId = await enqueueJob(prisma, {
      tenantId: input.tenantId,
      type: "APPLICATION_READ",
      payload: { documentId: doc.id, newDeal: true, noMerchantMatch: true },
      dedupeKey: `appread:${doc.id}`,
    });
  }
  await storeStatements(prisma, { tenantId: input.tenantId, dealId: deal.id }, input.statements);
  await prisma.dealEvent.create({
    data: {
      dealId: deal.id,
      type: "application_uploaded",
      actorType: "merchant",
      payload: {
        channel: "web",
        application: Boolean(input.application),
        statements: input.statements.length,
      },
    },
  });
  const token = await createWebApplication(prisma, {
    tenantId: input.tenantId,
    dealId: deal.id,
    origin: "public",
    lang: input.lang,
    email: input.email,
    phone: input.phone,
    ip: input.ip,
  });
  return { token, dealId: deal.id, readJobId };
}

/** Bank statements the merchant adds (start page, or later on their page). */
export async function storeStatements(
  prisma: PrismaClient,
  target: { tenantId: string; dealId: string },
  files: UploadedFile[],
): Promise<number> {
  if (!files.length) return 0;
  const mailbox = await tenantMailbox(prisma, target.tenantId);
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: target.dealId } });
  for (const f of files) {
    await storeDealFile(prisma, mailbox, {
      tenantId: target.tenantId,
      dealId: target.dealId,
      merchantId: deal.merchantId,
      file: { fileName: f.name, mimeType: f.type || "application/pdf", data: f.data },
      type: "BANK_STATEMENT",
      uploadedVia: "website",
    });
  }
  if (deal.stage === "DOCS_REQUESTED" || deal.stage === "INTAKE") {
    await prisma.deal.update({
      where: { id: deal.id },
      data: { stage: "DOCS_RECEIVED", stageChangedAt: new Date() },
    });
  }
  return files.length;
}

/** "reading" while the AI is still on the uploaded application (at most a few minutes). */
export async function readingInProgress(
  prisma: PrismaClient,
  dealId: string,
  now = new Date(),
): Promise<boolean> {
  const docs = await prisma.document.findMany({
    where: { dealId, type: "APPLICATION", internalOnly: true },
    select: { id: true },
  });
  if (!docs.length) return false;
  const job = await prisma.job.findFirst({
    where: {
      dedupeKey: { in: docs.map((d) => `appread:${d.id}`) },
      status: { in: ["QUEUED", "RUNNING"] },
    },
    select: { createdAt: true },
  });
  // A slow or stuck reading never blocks the merchant: after 4 minutes they type it in.
  return Boolean(job && now.getTime() - job.createdAt.getTime() < 4 * 60_000);
}

/** The application text the merchant agrees to (English authorization, plus Spanish reading). */
export async function consentFor(
  prisma: PrismaClient,
  tenantId: string,
  lang: Lang,
): Promise<{ authorization: string; translation: string | null; agreement: string }> {
  const authorization = await signatureConsent(prisma, tenantId);
  const custom = authorization !== SIGNATURE_CONSENT;
  return {
    authorization,
    // A tenant's own wording has no Spanish version; the default one does.
    translation: lang === "es" && !custom ? CONSENT_ES : null,
    agreement: ESIGN_AGREEMENT[lang],
  };
}

/** The merchant's pages show the EIN like the SSN: last 4 only (the PDF for lenders has it all). */
function maskEin(sections: ApplicationPdfSection[]): ApplicationPdfSection[] {
  return sections.map((s) => ({
    ...s,
    fields: s.fields.map(([k, v]) =>
      /\bEIN\b/.test(k) && v ? ([k, `**-***${v.slice(-4)}`] as [string, string]) : [k, v],
    ),
  }));
}

/** What the merchant reviews and signs, with a fingerprint so a changed application is caught. */
export async function reviewSnapshot(
  prisma: PrismaClient,
  row: { tenantId: string; dealId: string; lang: string },
) {
  const app = await dealApplication(prisma, row.tenantId, row.dealId);
  if (!app) return null;
  const lang: Lang = row.lang === "es" ? "es" : "en";
  const consent = await consentFor(prisma, row.tenantId, lang);
  const full = applicationSections(app.draft, app.pii, { masked: false });
  const fingerprint = sha256(JSON.stringify({ full, consent }));
  return {
    app,
    lang,
    consent,
    full,
    masked: maskEin(applicationSections(app.draft, app.pii, { masked: true })),
    missing: missingFields(app.draft, app.pii),
    fingerprint,
  };
}

export type SignResult =
  | { ok: true; documentId: string }
  | { ok: false; error: "expired" | "signed" | "changed" | "missing" | "agree" | "name" };

/**
 * The merchant ticked the agreement, typed their name and pressed Sign: the signed PDF is filed
 * on the deal (for lenders) and the proof is recorded (append-only).
 */
export async function signWebApplication(
  prisma: PrismaClient,
  token: string,
  input: {
    name: string;
    agreed: boolean;
    fingerprint: string;
    ip: string | null;
    userAgent: string | null;
  },
  now = new Date(),
): Promise<SignResult> {
  const row = await findWebApplication(prisma, token, now);
  if (!row) return { ok: false, error: "expired" };
  if (row.signedAt) return { ok: false, error: "signed" };
  const snap = await reviewSnapshot(prisma, row);
  if (!snap) return { ok: false, error: "expired" };
  if (snap.fingerprint !== input.fingerprint) return { ok: false, error: "changed" };
  if (snap.missing.length) return { ok: false, error: "missing" };
  if (!input.agreed) return { ok: false, error: "agree" };
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 120);
  const owner = snap.app.draft.owners[0] ?? {};
  if (!nameMatches(name, owner)) return { ok: false, error: "name" };

  // Claim the link first so a double click signs once.
  const claimed = await prisma.webApplication.updateMany({
    where: { id: row.id, signedAt: null },
    data: { signedAt: now },
  });
  if (claimed.count === 0) return { ok: false, error: "signed" };
  try {
    return await recordSignature(prisma, row, snap, { ...input, name }, now);
  } catch (err) {
    await prisma.webApplication.update({ where: { id: row.id }, data: { signedAt: null } });
    throw err;
  }
}

async function recordSignature(
  prisma: PrismaClient,
  row: { id: string; tenantId: string; dealId: string },
  snap: NonNullable<Awaited<ReturnType<typeof reviewSnapshot>>>,
  input: { name: string; ip: string | null; userAgent: string | null },
  now: Date,
): Promise<SignResult> {
  const { app, consent } = snap;
  const ref = `sig_${randomBytes(8).toString("hex")}`;
  const signature = {
    name: input.name,
    signedAt: now,
    via: `online application${input.ip ? `, IP ${input.ip}` : ""}`,
    ref,
  };
  const consentPdf = [
    consent.authorization,
    consent.translation ? `En español (texto aceptado en línea): ${consent.translation}` : null,
    `${consent.agreement}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const signedPdf = await renderApplicationPdf({
    brand: ASCEND_BRAND,
    title: APPLICATION_TITLE,
    sections: snap.full,
    consentText: consentPdf,
    signature,
  });
  const b = app.draft.business;
  const fileBase = applicationFileBase(b.dba ?? b.legalName);
  const mailbox = await tenantMailbox(prisma, row.tenantId);
  const doc = await storeDealFile(prisma, mailbox, {
    tenantId: row.tenantId,
    dealId: row.dealId,
    merchantId: app.deal.merchantId,
    file: { fileName: `${fileBase}.pdf`, mimeType: "application/pdf", data: signedPdf },
    type: "APPLICATION",
    uploadedVia: "website",
    // The fields are already structured; reading the PDF again would only cost money.
    autoProcess: false,
  });
  const owner = app.draft.owners[0] ?? {};
  await prisma.applicationSignature.create({
    data: {
      id: ref,
      tenantId: row.tenantId,
      dealId: row.dealId,
      channel: "web",
      signerName: input.name,
      ownerName: `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim(),
      phone: owner.phone ?? b.phone ?? "",
      consentText: consentPdf,
      consentSha256: sha256(consentPdf),
      documentId: doc.id,
      pdfSha256: sha256(signedPdf),
      signedAt: now,
      ipAddress: input.ip,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
    },
  });
  await prisma.webApplication.update({
    where: { id: row.id },
    data: { signatureId: ref, expiresAt: new Date(now.getTime() + COPY_DAYS * DAY) },
  });

  const statements = await prisma.document.count({
    where: { dealId: row.dealId, type: "BANK_STATEMENT" },
  });
  await prisma.deal.update({
    where: { id: row.dealId },
    data: {
      ...(["INTAKE", "DOCS_REQUESTED"].includes(app.deal.stage)
        ? { stage: statements ? "DOCS_RECEIVED" : "DOCS_REQUESTED", stageChangedAt: now }
        : {}),
      applicationData: {
        ...((app.deal.applicationData as Prisma.JsonObject | null) ?? {}),
        signed: true,
        signedVia: "web",
        signatureId: ref,
        signedDocumentId: doc.id,
      } as Prisma.InputJsonObject,
    },
  });
  await prisma.dealEvent.create({
    data: {
      dealId: row.dealId,
      type: "application_signed",
      actorType: "merchant",
      payload: { channel: "web", signatureId: ref, documentId: doc.id },
    },
  });

  // The Drive folder was named after the placeholder; give it the merchant's name.
  const folderId = (await prisma.deal.findUnique({ where: { id: row.dealId } }))?.driveFolderId;
  if (folderId && "rename" in mailbox.drive && b.legalName) {
    const folder = dealFolderPath(b.dba ?? b.legalName, row.dealId).at(-1)!;
    await mailbox.drive.rename(folderId, folder).catch((err: unknown) => {
      console.error(`[web application ${row.id}] folder rename failed`, err);
    });
  }
  return { ok: true, documentId: doc.id };
}

/** The merchant's copy: the signed application with SSN and date of birth masked. */
export async function merchantCopy(
  prisma: PrismaClient,
  row: { tenantId: string; dealId: string; signatureId: string | null; lang: string },
): Promise<{ fileName: string; data: Buffer } | null> {
  if (!row.signatureId) return null;
  const sig = await prisma.applicationSignature.findUnique({ where: { id: row.signatureId } });
  const app = await dealApplication(prisma, row.tenantId, row.dealId);
  if (!sig || !app) return null;
  const sections = maskEin(applicationSections(app.draft, app.pii, { masked: true }));
  const data = await renderApplicationPdf({
    brand: ASCEND_BRAND,
    title: APPLICATION_TITLE,
    sections,
    consentText: sig.consentText,
    signature: {
      name: sig.signerName,
      signedAt: sig.signedAt,
      via: `online application${sig.ipAddress ? `, IP ${sig.ipAddress}` : ""}`,
      ref: sig.id,
    },
  });
  const b = app.draft.business;
  return { fileName: `${applicationFileBase(b.dba ?? b.legalName)}.pdf`, data };
}
