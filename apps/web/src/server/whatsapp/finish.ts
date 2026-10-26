import { randomBytes, createHash } from "node:crypto";
import { dealFolderPath, renderApplicationPdf, type ApplicationPdfSection } from "@mca/connectors";
import type { Prisma } from "@mca/db";
import { applyApplication } from "../applicationData";
import {
  APPLICATION_PDF,
  applicationFileBase,
  applicationSections as sharedSections,
} from "../ascendApplication";
import { storeDealFile } from "../documents";
import { ApplicationPayloadSchema, findMerchantMatch, payloadToReading } from "../websiteApi";
import { handoff, say, sendFile, ownerName, type Ctx } from "./chat";
import { COPY, DEFAULT_CONSENT, tr } from "./copy";
import { formatPhone, maskPhone, type Lang } from "./questions";

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

/** Ascend's application sections for this chat's answers. */
export function applicationSections(x: Ctx, opts: { masked: boolean }): ApplicationPdfSection[] {
  return sharedSections(x.draft, x.pii, opts);
}

/** English authorization on the PDF; a Spanish signer also gets the text they agreed to. */
async function pdfConsent(x: Ctx): Promise<string> {
  const en = await consentFor(x, "en");
  return x.lang === "es"
    ? `${en}\n\nEn español (texto aceptado en WhatsApp): ${await consentFor(x, "es")}`
    : en;
}

const fileBase = (x: Ctx) =>
  applicationFileBase(x.draft.business.dba ?? x.draft.business.legalName);

/** Unsigned preview (masked) for the review step. */
export async function renderApplication(
  x: Ctx,
  opts: { masked: boolean },
): Promise<{ fileName: string; data: Buffer }> {
  const data = await renderApplicationPdf({
    ...APPLICATION_PDF,
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
    ...APPLICATION_PDF,
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
    ...APPLICATION_PDF,
    sections: applicationSections(x, { masked: true }),
    consentText: consentPdf,
    signature,
  });
  await sendFile(x, { fileName: `${fileBase(x)}.pdf`, data: copy }, tr(COPY.signedCaption, x.lang));
}
