import { randomBytes, createHash } from "node:crypto";
import { dealFolderPath, renderApplicationPdf, type ApplicationPdfSection } from "@mca/connectors";
import type { Prisma } from "@mca/db";
import { applyApplication } from "../applicationData";
import { storeDealFile } from "../documents";
import { ApplicationPayloadSchema, findMerchantMatch, payloadToReading } from "../websiteApi";
import { handoff, say, sendFile, ownerName, type Ctx } from "./chat";
import { COPY, DEFAULT_CONSENT, tr } from "./copy";
import { FIELDS, formatPhone, maskPhone, showAddress, type Lang } from "./questions";

const BRAND = "Ascend Fund";
const TITLE = "Business Funding Application";

/** The authorization the merchant reads in the chat (tenant setting, or the default). */
export async function consentFor(x: Ctx, lang: Lang = x.lang): Promise<string> {
  const tenant = await x.prisma.tenant.findUnique({
    where: { id: x.c.tenantId },
    select: { settings: true },
  });
  const custom = (tenant?.settings as { whatsapp?: { consentEn?: string; consentEs?: string } })
    ?.whatsapp;
  const text = lang === "es" ? custom?.consentEs : custom?.consentEn;
  return text?.trim() || DEFAULT_CONSENT[lang];
}

/** US style for lenders: 2021-04-01 → 04/01/2021. */
const usDate = (v: string | undefined | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (v ?? null);
};

const label = (key: string) => FIELDS.find((f) => f.key === key)!.label.en;
const show = (key: string, x: Ctx) => {
  const f = FIELDS.find((d) => d.key === key)!;
  return f.show(f.get(x.draft)) || null;
};

/** Ascend's application sections (English, as lenders read it). */
export function applicationSections(x: Ctx, opts: { masked: boolean }): ApplicationPdfSection[] {
  const b = x.draft.business;
  const sections: ApplicationPdfSection[] = [
    {
      heading: "Business",
      fields: [
        [label("business.legalName"), b.legalName ?? null],
        [label("business.dba"), b.dba ?? null],
        [label("business.entityType"), show("business.entityType", x)],
        [label("business.ein"), b.ein ?? null],
        [label("business.startDate"), usDate(b.startDate)],
        [label("business.industry"), b.industry ?? null],
        [label("business.address"), showAddress(b.address) || null],
        [label("business.phone"), b.phone ?? null],
        [label("business.email"), b.email ?? null],
        ["Website", b.website ?? null],
      ],
    },
    {
      heading: "Funding request",
      fields: [
        [label("request.amount"), show("request.amount", x)],
        [label("request.useOfFunds"), x.draft.request.useOfFunds ?? null],
        [label("request.monthlyRevenue"), show("request.monthlyRevenue", x)],
        [label("request.existingAdvances"), show("request.existingAdvances", x)],
      ],
    },
  ];
  x.draft.owners.forEach((o, i) => {
    const pii = x.pii[i];
    const ssn = pii?.ssn ? (opts.masked ? `***-**-${pii.ssn.slice(-4)}` : pii.ssn) : null;
    const dob = pii?.dob ? (opts.masked ? "On file" : usDate(pii.dob)) : null;
    const phone = o.phone ?? (i === 0 ? formatPhone(x.c.phone) : null);
    sections.push({
      heading: x.draft.owners.length > 1 ? `Owner ${i + 1}` : "Owner",
      fields: [
        ["Full name", `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || null],
        ["Ownership", o.ownershipPct !== undefined ? `${o.ownershipPct}%` : null],
        ["Social Security number", ssn],
        ["Date of birth", dob],
        ["Home address", showAddress(o.address) || null],
        ["Email", o.email ?? null],
        ["Phone", phone],
        ["Credit score (estimated)", o.creditScore ? String(o.creditScore) : null],
      ],
    });
  });
  return sections;
}

/** English authorization on the PDF; a Spanish signer also gets the text they agreed to. */
async function pdfConsent(x: Ctx): Promise<string> {
  const en = await consentFor(x, "en");
  return x.lang === "es"
    ? `${en}\n\nEn español (texto aceptado en WhatsApp): ${await consentFor(x, "es")}`
    : en;
}

const fileBase = (x: Ctx) =>
  `Ascend-Fund-Application-${(x.draft.business.dba ?? x.draft.business.legalName ?? "Merchant")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")}`;

/** Unsigned preview (masked) for the review step. */
export async function renderApplication(
  x: Ctx,
  opts: { masked: boolean },
): Promise<{ fileName: string; data: Buffer }> {
  const data = await renderApplicationPdf({
    brand: BRAND,
    title: TITLE,
    sections: applicationSections(x, opts),
    consentText: await pdfConsent(x),
    note: "Preview - not signed yet",
  });
  return { fileName: `${fileBase(x)}-preview.pdf`, data };
}

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const strip = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/**
 * The merchant tapped "I agree, sign": the application goes onto the deal (same path as the
 * website API), the signed PDF is stored for lenders, the signature proof is recorded and the
 * merchant gets a copy.
 */
export async function signApplication(x: Ctx, opts: { agreeMessageId: string | null }) {
  const now = x.deps.now();
  const owner = x.draft.owners[0] ?? {};
  const b = x.draft.business;
  const payload = ApplicationPayloadSchema.safeParse(
    strip({
      externalId: `wa:${x.c.id}`,
      business: b,
      request: x.draft.request,
      owners: x.draft.owners
        .map((o, i) => ({
          ...o,
          phone: o.phone ?? (i === 0 ? formatPhone(x.c.phone) : undefined),
          ssn: x.pii[i]?.ssn ?? undefined,
          dob: x.pii[i]?.dob ?? undefined,
        }))
        // Extra owners the PDF named only in part stay on the PDF for the team, not in the CRM.
        .filter((o, i) => i === 0 || (o.firstName && o.lastName)),
      signedAt: now.toISOString(),
      files: [],
    }),
  );
  if (!payload.success) {
    // Should not happen (answers are checked as they come in); a person finishes it instead.
    console.error(
      `[whatsapp ${x.c.id}] cannot sign: ${payload.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
    return handoff(x, COPY.failed);
  }
  const p = payload.data;
  const dealId = x.c.dealId!;
  const deal = await x.prisma.deal.findUniqueOrThrow({ where: { id: dealId } });

  // A returning merchant keeps one record: move the deal off the WhatsApp placeholder.
  let merchantId = deal.merchantId;
  const match = await findMerchantMatch(
    x.prisma,
    x.c.tenantId,
    p.business.legalName,
    p.business.ein,
    merchantId,
  );
  if (match) {
    const placeholder = merchantId;
    merchantId = match.id;
    await x.prisma.$transaction([
      x.prisma.deal.update({ where: { id: dealId }, data: { merchantId } }),
      x.prisma.document.updateMany({ where: { dealId }, data: { merchantId } }),
    ]);
    const others = await x.prisma.deal.count({ where: { merchantId: placeholder } });
    if (!others)
      await x.prisma.merchant.delete({ where: { id: placeholder } }).catch(() => undefined);
  }
  await applyApplication(x.prisma, { dealId, merchantId }, payloadToReading(p), "overwrite");

  const ref = `sig_${randomBytes(8).toString("hex")}`;
  const signature = {
    name: x.c.pendingSignerName ?? ownerName(x),
    signedAt: now,
    via: `WhatsApp ${maskPhone(x.c.phone)}`,
    ref,
  };
  const consentPdf = await pdfConsent(x);
  const sections = applicationSections(x, { masked: false });
  const signedPdf = await renderApplicationPdf({
    brand: BRAND,
    title: TITLE,
    sections,
    consentText: consentPdf,
    signature,
  });
  const mailbox = await x.deps.mailbox();
  const doc = await storeDealFile(x.prisma, mailbox, {
    tenantId: x.c.tenantId,
    dealId,
    merchantId,
    file: { fileName: `${fileBase(x)}.pdf`, mimeType: "application/pdf", data: signedPdf },
    type: "APPLICATION",
    uploadedVia: "whatsapp",
    // Fields are already structured; reading the PDF again would only cost money.
    autoProcess: false,
  });

  const consentShown = await consentFor(x);
  await x.prisma.applicationSignature.create({
    data: {
      id: ref,
      tenantId: x.c.tenantId,
      dealId,
      channel: "whatsapp",
      conversationId: x.c.id,
      signerName: signature.name,
      ownerName: `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim(),
      phone: x.c.phone,
      consentText: consentShown,
      consentSha256: sha256(consentShown),
      nameMessageId: x.c.pendingNameMessageId,
      agreeMessageId: opts.agreeMessageId,
      documentId: doc.id,
      pdfSha256: sha256(signedPdf),
      signedAt: now,
    },
  });

  const statements = await x.prisma.document.count({
    where: { dealId, type: "BANK_STATEMENT" },
  });
  await x.prisma.deal.update({
    where: { id: dealId },
    data: {
      ...(["INTAKE", "DOCS_REQUESTED"].includes(deal.stage)
        ? {
            stage: statements ? "DOCS_RECEIVED" : "DOCS_REQUESTED",
            stageChangedAt: now,
          }
        : {}),
      applicationData: {
        source: "whatsapp",
        conversationId: x.c.id,
        signed: true,
        signatureId: ref,
        documentId: doc.id,
        readFromDocumentId: x.meta.sourceDocId ?? null,
        conflicts: [],
      } as Prisma.InputJsonObject,
    },
  });
  await x.prisma.dealEvent.create({
    data: {
      dealId,
      type: "application_signed",
      actorType: "system",
      payload: { channel: "whatsapp", signatureId: ref, documentId: doc.id },
    },
  });

  // The Drive folder was named after the placeholder; give it the merchant's name.
  const folderId = (await x.prisma.deal.findUnique({ where: { id: dealId } }))?.driveFolderId;
  if (folderId && "rename" in mailbox.drive) {
    const name = dealFolderPath(p.business.dba ?? p.business.legalName, dealId).at(-1)!;
    await mailbox.drive.rename(folderId, name).catch((err: unknown) => {
      console.error(`[whatsapp ${x.c.id}] folder rename failed`, err);
    });
  }

  x.c.status = "SIGNED";
  x.c.step = null;
  x.c.pendingSignerName = null;
  x.c.pendingNameMessageId = null;
  await say(x, tr(COPY.signed, x.lang)(owner.firstName ?? ""));
  const copy = await renderApplicationPdf({
    brand: BRAND,
    title: TITLE,
    sections: applicationSections(x, { masked: true }),
    consentText: consentPdf,
    signature,
  });
  await sendFile(x, { fileName: `${fileBase(x)}.pdf`, data: copy }, tr(COPY.signedCaption, x.lang));
}
