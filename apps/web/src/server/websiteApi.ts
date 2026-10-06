import type { ApplicationReading } from "@mca/ai";
import type { DocumentType, PrismaClient } from "@mca/db";
import { z } from "zod";
import { applyApplication } from "./applicationData";
import { storeDealFile } from "./documents";
import { tenantMailbox, MailboxNotConnectedError } from "./google";

/** Payload Ascend's website posts when a merchant submits the application form. */
const s = (max = 200) => z.string().trim().min(1).max(max).optional();
const DOC_TYPES = [
  "APPLICATION",
  "BANK_STATEMENT",
  "MTD_STATEMENT",
  "VOIDED_CHECK",
  "DRIVERS_LICENSE",
  "TAX_RETURN",
  "OTHER",
] as const;
const MAX_FILE_BYTES = 3 * 1024 * 1024;

export const FileUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z
    .string()
    .regex(/^(application\/pdf|image\/(jpeg|png)|application\/vnd\.[\w.+-]+)$/),
  base64: z.string().min(4),
  type: z.enum(DOC_TYPES).optional(),
});

export const ApplicationPayloadSchema = z.object({
  /** The website's own id for this application; re-posting it never creates a second deal. */
  externalId: z.string().trim().min(1).max(100),
  business: z.object({
    legalName: z.string().trim().min(1).max(200),
    dba: s(),
    entityType: z
      .enum(["LLC", "CORP", "S_CORP", "SOLE_PROP", "PARTNERSHIP", "NONPROFIT", "OTHER"])
      .optional(),
    ein: z
      .string()
      .regex(/^\d{2}-?\d{7}$/)
      .optional(),
    startDate: z.iso.date().optional(),
    industry: s(),
    naics: z
      .string()
      .regex(/^\d{2,6}$/)
      .optional(),
    phone: s(40),
    email: z.email().optional(),
    website: s(),
    address: z
      .object({
        line1: s(),
        city: s(100),
        state: z
          .string()
          .regex(/^[A-Za-z]{2}$/)
          .optional(),
        postalCode: s(20),
      })
      .optional(),
  }),
  request: z
    .object({
      amount: z.number().positive().max(10_000_000).optional(),
      useOfFunds: s(500),
      monthlyRevenue: z.number().nonnegative().optional(),
      existingAdvances: z
        .array(
          z.object({
            lender: z.string().trim().min(1).max(100),
            balance: z.number().nonnegative().optional(),
          }),
        )
        .max(20)
        .optional(),
    })
    .optional(),
  owners: z
    .array(
      z.object({
        firstName: z.string().trim().min(1).max(100),
        lastName: z.string().trim().min(1).max(100),
        ownershipPct: z.number().min(0).max(100).optional(),
        ssn: z
          .string()
          .regex(/^\d{3}-?\d{2}-?\d{4}$/)
          .optional(),
        dob: z.iso.date().optional(),
        email: z.email().optional(),
        phone: s(40),
        address: z
          .object({
            line1: s(),
            city: s(100),
            state: z
              .string()
              .regex(/^[A-Za-z]{2}$/)
              .optional(),
            postalCode: s(20),
          })
          .optional(),
        creditScore: z.number().int().min(300).max(850).optional(),
      }),
    )
    .max(4)
    .default([]),
  signedAt: z.iso.datetime({ offset: true }).optional(),
  files: z.array(FileUploadSchema).max(8).default([]),
});

export type ApplicationPayload = z.infer<typeof ApplicationPayloadSchema>;
export type FileUpload = z.infer<typeof FileUploadSchema>;

/** The API payload in the same shape A5 produces, so one function applies both. */
export function payloadToReading(p: ApplicationPayload): ApplicationReading {
  const n = <T>(v: T | undefined) => (v === undefined ? null : v);
  return {
    isApplication: true,
    business: {
      legalName: p.business.legalName,
      dba: n(p.business.dba),
      entityType: n(p.business.entityType),
      ein: n(p.business.ein),
      startDate: n(p.business.startDate),
      industry: n(p.business.industry),
      naics: n(p.business.naics),
      phone: n(p.business.phone),
      email: n(p.business.email),
      website: n(p.business.website),
      addressLine1: n(p.business.address?.line1),
      city: n(p.business.address?.city),
      state: n(p.business.address?.state),
      postalCode: n(p.business.address?.postalCode),
    },
    request: {
      requestedAmount: n(p.request?.amount),
      useOfFunds: n(p.request?.useOfFunds),
      statedMonthlyRevenue: n(p.request?.monthlyRevenue),
      existingAdvances: (p.request?.existingAdvances ?? []).map((x) => ({
        lender: x.lender,
        balance: n(x.balance),
      })),
    },
    owners: p.owners.map((o) => ({
      firstName: o.firstName,
      lastName: o.lastName,
      ownershipPct: n(o.ownershipPct),
      ssn: n(o.ssn),
      dob: n(o.dob),
      email: n(o.email),
      phone: n(o.phone),
      addressLine1: n(o.address?.line1),
      city: n(o.address?.city),
      state: n(o.address?.state),
      postalCode: n(o.address?.postalCode),
      creditScoreStated: n(o.creditScore),
    })),
    signed: Boolean(p.signedAt),
    signatureDate: p.signedAt?.slice(0, 10) ?? null,
    lowConfidenceFields: [],
    confidence: 1,
  };
}

export class ApiInputError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function decodeFiles(files: FileUpload[]) {
  return files.map((f) => {
    const data = Buffer.from(f.base64, "base64");
    if (data.length === 0) throw new ApiInputError(422, `${f.fileName}: empty file`);
    if (data.length > MAX_FILE_BYTES) {
      throw new ApiInputError(
        413,
        `${f.fileName}: over 3 MB; email large statements to the funding inbox instead`,
      );
    }
    return {
      fileName: f.fileName,
      mimeType: f.contentType,
      data,
      type: f.type as DocumentType | undefined,
    };
  });
}

export async function storeApiFiles(
  prisma: PrismaClient,
  tenantId: string,
  deal: { id: string; merchantId: string },
  files: ReturnType<typeof decodeFiles>,
  opts: { readApplication: boolean },
) {
  if (files.length === 0) return [];
  let mailbox;
  try {
    mailbox = await tenantMailbox(prisma, tenantId);
  } catch (err) {
    if (err instanceof MailboxNotConnectedError) {
      throw new ApiInputError(503, "Google Drive is not connected yet; files cannot be stored");
    }
    throw err;
  }
  const docs = [];
  for (const f of files) {
    docs.push(
      await storeDealFile(prisma, mailbox, {
        tenantId,
        dealId: deal.id,
        merchantId: deal.merchantId,
        file: { fileName: f.fileName, mimeType: f.mimeType, data: f.data },
        type: f.type,
        uploadedVia: "website",
        // The website already sent structured fields; reading the PDF again would only cost money.
        autoProcess: f.type === "APPLICATION" ? opts.readApplication : true,
      }),
    );
  }
  return docs;
}

/**
 * Creates (or, for a repeated externalId, returns) the deal for a website application.
 * The merchant is matched on EIN last 4 + legal name so a returning merchant keeps one record.
 */
export async function ingestApplication(
  prisma: PrismaClient,
  tenantId: string,
  p: ApplicationPayload,
) {
  const existing = await prisma.deal.findUnique({
    where: { tenantId_externalRef: { tenantId, externalRef: p.externalId } },
  });
  if (existing) return { deal: existing, created: false, documents: [] };

  const files = decodeFiles(p.files);
  const einLast4 = p.business.ein?.replace(/\D/g, "").slice(-4) ?? null;
  const merchant =
    (await prisma.merchant.findFirst({
      where: {
        tenantId,
        legalName: { equals: p.business.legalName, mode: "insensitive" },
        ...(einLast4 ? { OR: [{ einLast4 }, { einLast4: null }] } : {}),
      },
    })) ?? (await prisma.merchant.create({ data: { tenantId, legalName: p.business.legalName } }));

  const hasStatements = files.some((f) => f.type === "BANK_STATEMENT");
  const deal = await prisma.deal.create({
    data: {
      tenantId,
      merchantId: merchant.id,
      source: "website",
      externalRef: p.externalId,
      stage: hasStatements ? "DOCS_RECEIVED" : "DOCS_REQUESTED",
    },
  });
  await applyApplication(
    prisma,
    { dealId: deal.id, merchantId: merchant.id },
    payloadToReading(p),
    "overwrite",
  );
  await prisma.dealEvent.create({
    data: {
      dealId: deal.id,
      type: "application_received",
      actorType: "system",
      payload: { source: "website", externalId: p.externalId },
    },
  });
  const documents = await storeApiFiles(prisma, tenantId, deal, files, { readApplication: false });
  return { deal, created: true, documents };
}
