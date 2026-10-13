import { imagesToPdf, renderApplicationPdf, type ApplicationPdfSection } from "@mca/connectors";
import { decryptSecret, type PrismaClient } from "@mca/db";
import { requireEnv } from "./env";
import { FIELDS, showAddress, type Address, type Draft } from "./whatsapp/questions";

/**
 * Ascend's own application, filled from what the CRM knows about a deal. The same sections are
 * used by the WhatsApp bot (signed by typed name) and by the deal page download (printed or
 * sent for signature, then uploaded back signed).
 */
export const ASCEND_BRAND = "Ascend Fund";
export const APPLICATION_TITLE = "Business Funding Application";

/** Merchant name a deal has while its uploaded application is still being read. */
export const READING_PLACEHOLDER = "New application (reading…)";

/** Authorization printed above the signature line on the downloaded application. */
export const SIGNATURE_CONSENT =
  "By signing below, I certify that I am an owner of the business named in this application and that the information in it and in the documents provided is true, correct and complete. I authorize Ascend Fund, its agents and the funding partners it shares this application with to obtain business and personal credit reports, bank and trade references and other information about the business and its owners, and to share this application and its documents with those funding partners. I agree that an electronic signature on this application has the same effect as a handwritten signature.";

export interface OwnerPii {
  ssn: string | null;
  dob: string | null;
}

/** 2021-04-01 → 04/01/2021, the way lenders read dates. */
export const usDate = (v: string | undefined | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (v ?? null);
};

const label = (key: string) => FIELDS.find((f) => f.key === key)!.label.en;
const show = (key: string, d: Draft) => {
  const f = FIELDS.find((x) => x.key === key)!;
  return f.show(f.get(d)) || null;
};

/** Ascend's application sections (English, as lenders read it). */
export function applicationSections(
  draft: Draft,
  pii: OwnerPii[],
  opts: { masked: boolean; firstOwnerPhone?: string | null },
): ApplicationPdfSection[] {
  const b = draft.business;
  const sections: ApplicationPdfSection[] = [
    {
      heading: "Business",
      fields: [
        [label("business.legalName"), b.legalName ?? null],
        [label("business.dba"), b.dba ?? null],
        [label("business.entityType"), show("business.entityType", draft)],
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
        [label("request.amount"), show("request.amount", draft)],
        [label("request.useOfFunds"), draft.request.useOfFunds ?? null],
        [label("request.monthlyRevenue"), show("request.monthlyRevenue", draft)],
        [label("request.existingAdvances"), show("request.existingAdvances", draft)],
      ],
    },
  ];
  draft.owners.forEach((o, i) => {
    const p = pii[i];
    const ssn = p?.ssn ? (opts.masked ? `***-**-${p.ssn.slice(-4)}` : p.ssn) : null;
    const dob = p?.dob ? (opts.masked ? "On file" : usDate(p.dob)) : null;
    const phone = o.phone ?? (i === 0 ? (opts.firstOwnerPhone ?? null) : null);
    sections.push({
      heading: draft.owners.length > 1 ? `Owner ${i + 1}` : "Owner",
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

/** "Ascend-Fund-Application-Sample-Bistro" (the house file name lenders already know). */
export function applicationFileBase(name: string | undefined | null): string {
  const clean = (name ?? "Merchant").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  return `Ascend-Fund-Application-${clean || "Merchant"}`;
}

/** Tenant wording from Settings, else the default. */
export async function signatureConsent(prisma: PrismaClient, tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  const custom = (tenant?.settings as { application?: { consent?: string } } | null)?.application;
  return custom?.consent?.trim() || SIGNATURE_CONSENT;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const address = (a: {
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}): Address | undefined =>
  a.addressLine1 || a.city || a.state || a.postalCode
    ? {
        line1: opt(a.addressLine1),
        city: opt(a.city),
        state: opt(a.state),
        postalCode: opt(a.postalCode),
      }
    : undefined;

/** Everything the CRM holds for a deal, in the application's shape (PII decrypted). */
export async function dealApplication(prisma: PrismaClient, tenantId: string, dealId: string) {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, tenantId },
    include: {
      merchant: { include: { owners: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } } },
    },
  });
  if (!deal) return null;
  // The key is only needed once something is stored encrypted.
  const dec = (v: string | null) => (v ? decryptSecret(v, requireEnv("PII_ENCRYPTION_KEY")) : null);
  const m = deal.merchant;
  const positions = (deal.submissionPositions ?? []) as {
    funder?: string;
    balance?: number | null;
  }[];
  const draft: Draft = {
    business: {
      legalName: m.legalName === READING_PLACEHOLDER ? undefined : m.legalName,
      dba: opt(m.dba),
      entityType: opt(m.entityType),
      ein: opt(dec(m.einEncrypted)),
      startDate: m.startDate ? m.startDate.toISOString().slice(0, 10) : undefined,
      industry: opt(m.industry),
      naics: opt(m.naics),
      phone: opt(m.phone),
      email: opt(m.email),
      website: opt(m.website),
      address: address(m),
    },
    request: {
      amount: deal.requestedAmount ? Number(deal.requestedAmount) : undefined,
      useOfFunds: opt(deal.useOfFunds),
      monthlyRevenue: deal.statedMonthlyRevenue ? Number(deal.statedMonthlyRevenue) : undefined,
      existingAdvances: positions
        .filter((p) => p.funder)
        .map((p) => ({
          lender: p.funder!,
          ...(typeof p.balance === "number" ? { balance: p.balance } : {}),
        })),
    },
    owners: m.owners.map((o) => ({
      firstName: o.firstName,
      lastName: o.lastName,
      ownershipPct: o.ownershipPct !== null ? Number(o.ownershipPct) : undefined,
      email: opt(o.email),
      phone: opt(o.phone),
      address: address(o),
      creditScore: opt(o.ficoEstimate),
    })),
  };
  if (draft.owners.length === 0) draft.owners.push({});
  const pii: OwnerPii[] = m.owners.map((o) => ({
    ssn: dec(o.ssnEncrypted),
    dob: dec(o.dobEncrypted),
  }));
  return { deal, merchant: m, owners: m.owners, draft, pii };
}

/** Required application fields the deal is still missing (labels for the deal page). */
export function missingFields(draft: Draft, pii: OwnerPii[]): string[] {
  const empty = (v: unknown) => v === undefined || v === null || v === "";
  // An empty positions box means "no advances", so that one is never reported missing.
  const out = FIELDS.filter(
    (f) => f.required && f.key !== "request.existingAdvances" && empty(f.get(draft)),
  ).map((f) => f.label.en);
  if (!pii[0]?.ssn) out.push("Owner SSN");
  if (!pii[0]?.dob) out.push("Owner date of birth");
  return out;
}

/** The unsigned Ascend application for a deal, with an empty signature line. */
export async function renderDealApplication(
  prisma: PrismaClient,
  tenantId: string,
  dealId: string,
): Promise<{ fileName: string; data: Buffer } | null> {
  const app = await dealApplication(prisma, tenantId, dealId);
  if (!app) return null;
  const data = await renderApplicationPdf({
    brand: ASCEND_BRAND,
    title: APPLICATION_TITLE,
    sections: applicationSections(app.draft, app.pii, { masked: false }),
    consentText: await signatureConsent(prisma, tenantId),
    signerName:
      `${app.draft.owners[0]?.firstName ?? ""} ${app.draft.owners[0]?.lastName ?? ""}`.trim() ||
      undefined,
  });
  const name = app.draft.business.dba ?? app.draft.business.legalName;
  return { fileName: `${applicationFileBase(name)}.pdf`, data };
}

const PHOTO = /^image\/(jpe?g|png)$/;

/** The application as one PDF: the PDF itself, or the page photos joined in order. */
export async function applicationUploadToPdf(
  files: { name: string; type: string; data: Buffer }[],
): Promise<{ fileName: string; data: Buffer }> {
  const pdfs = files.filter((f) => f.type === "application/pdf");
  if (pdfs.length > 1) throw new Error("Upload one application PDF (or photos of its pages).");
  if (pdfs.length === 1) {
    if (files.length > 1)
      throw new Error("Upload either the PDF or photos of the pages, not both.");
    return { fileName: pdfs[0]!.name, data: pdfs[0]!.data };
  }
  if (!files.every((f) => PHOTO.test(f.type))) {
    throw new Error("The application must be a PDF, or JPG/PNG photos of its pages.");
  }
  const n = files.length;
  return {
    fileName: `Application photos (${n} page${n === 1 ? "" : "s"}).pdf`,
    data: await imagesToPdf(files.map((f) => ({ mimeType: f.type, data: f.data }))),
  };
}
