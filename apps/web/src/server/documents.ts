import { createHash } from "node:crypto";
import type { Attachment, DealSubfolder } from "@mca/connectors";
import { enqueueJob, type DocumentType, type PrismaClient } from "@mca/db";
import { dealSubfolder, ensureDealFolder, type Mailbox } from "./google";

/** Best guess from the file name; the processor can re-label it on the deal page. */
export function classifyFileName(fileName: string): {
  type: DocumentType;
  subfolder: DealSubfolder;
} {
  const n = fileName.toLowerCase();
  if (/\bmtd\b|month[\s_-]*to[\s_-]*date/.test(n))
    return { type: "MTD_STATEMENT", subfolder: "MTD" };
  if (/applica|\bapp\b/.test(n)) return { type: "APPLICATION", subfolder: "Application" };
  if (/contract|agreement|docusign/.test(n)) return { type: "CONTRACT", subfolder: "Contracts" };
  if (/void(ed)?[\s_-]*check|\bvc\b/.test(n)) return { type: "VOIDED_CHECK", subfolder: "Stips" };
  if (/driver|licen[cs]e|\bdl\b|\bid\b/.test(n))
    return { type: "DRIVERS_LICENSE", subfolder: "Stips" };
  if (
    /statement|stmt|bank|chase|wells|bofa|pnc|citi|capital[\s_-]*one|truist|regions/.test(n) ||
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s_-]*\d{2,4}/.test(n)
  ) {
    return { type: "BANK_STATEMENT", subfolder: "Statements" };
  }
  return { type: "OTHER", subfolder: "Stips" };
}

export interface StoreFileInput {
  tenantId: string;
  dealId: string;
  merchantId: string | null;
  file: Attachment;
  uploadedVia: "staff" | "email" | "funder_email" | "website";
  uploadedById?: string | null;
  gmailMessageId?: string | null;
  type?: DocumentType;
  /** Queue AI work for the new file (application reading). Default true. */
  autoProcess?: boolean;
}

/**
 * Uploads one file into the deal's Drive folder and records it as a Document. The same bytes
 * already on the deal (same sha256) are not uploaded twice, so re-synced emails are harmless.
 */
export async function storeDealFile(prisma: PrismaClient, mailbox: Mailbox, input: StoreFileInput) {
  const sha256 = createHash("sha256").update(input.file.data).digest("hex");
  const existing = await prisma.document.findFirst({ where: { dealId: input.dealId, sha256 } });
  if (existing) return existing;

  const guess = classifyFileName(input.file.fileName);
  const type = input.type ?? guess.type;
  const folderId = await ensureDealFolder(prisma, mailbox, input.dealId);
  const sub = input.type ? subfolderForType(input.type) : guess.subfolder;
  const stored = await mailbox.drive.upload(
    input.file,
    await dealSubfolder(mailbox, folderId, sub),
  );

  const doc = await prisma.document.create({
    data: {
      tenantId: input.tenantId,
      dealId: input.dealId,
      merchantId: input.merchantId,
      type,
      driveFileId: stored.id,
      driveWebViewLink: stored.webViewLink,
      fileName: input.file.fileName,
      mimeType: input.file.mimeType,
      sizeBytes: input.file.data.length,
      sha256,
      uploadedVia: input.uploadedVia,
      uploadedById: input.uploadedById ?? null,
      gmailMessageId: input.gmailMessageId ?? null,
    },
  });
  if (input.autoProcess !== false) await queueDocumentWork(prisma, doc);
  return doc;
}

const READABLE = /^(application\/pdf|image\/(jpe?g|png))$/;

/**
 * New files start their AI work: applications are read (A5) to fill merchant and owner fields,
 * bank statements are extracted and scrubbed.
 */
export async function queueDocumentWork(
  prisma: PrismaClient,
  doc: {
    id: string;
    tenantId: string;
    dealId: string | null;
    type: DocumentType;
    mimeType: string;
  },
): Promise<string[]> {
  const ids: string[] = [];
  if (!doc.dealId || !READABLE.test(doc.mimeType)) return ids;
  if (doc.type === "APPLICATION") {
    ids.push(
      await enqueueJob(prisma, {
        tenantId: doc.tenantId,
        type: "APPLICATION_READ",
        payload: { documentId: doc.id },
        dedupeKey: `appread:${doc.id}`,
      }),
    );
  }
  if (doc.type === "BANK_STATEMENT" && doc.mimeType === "application/pdf") {
    ids.push(
      await enqueueJob(prisma, {
        tenantId: doc.tenantId,
        type: "STATEMENT_EXTRACT",
        payload: { documentId: doc.id },
        dedupeKey: `extract:${doc.id}`,
      }),
    );
  }
  return ids;
}

function subfolderForType(t: DocumentType): DealSubfolder {
  switch (t) {
    case "APPLICATION":
      return "Application";
    case "BANK_STATEMENT":
      return "Statements";
    case "MTD_STATEMENT":
      return "MTD";
    case "CONTRACT":
    case "DISCLOSURE":
      return "Contracts";
    default:
      return "Stips";
  }
}

/** Default package: the newest application plus the latest four bank statements. */
export function defaultPackage<
  D extends {
    id: string;
    type: DocumentType;
    createdAt: Date;
    periodEnd: Date | null;
    internalOnly?: boolean;
  },
>(all: D[]): string[] {
  const docs = all.filter((d) => !d.internalOnly);
  const newest = (a: D, b: D) =>
    (b.periodEnd ?? b.createdAt).getTime() - (a.periodEnd ?? a.createdAt).getTime();
  const app = docs.filter((d) => d.type === "APPLICATION").sort(newest)[0];
  const statements = docs
    .filter((d) => d.type === "BANK_STATEMENT")
    .sort(newest)
    .slice(0, 4);
  return [...(app ? [app.id] : []), ...statements.map((d) => d.id)];
}
