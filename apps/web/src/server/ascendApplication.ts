import { imagesToPdf, renderApplicationPdf, type ApplicationPdfSection } from "@mca/connectors";
import { decryptSecret, type PrismaClient } from "@mca/db";
import { requireEnv } from "./env";
import { FIELDS, type Address, type Draft } from "./whatsapp/questions";

/**
 * Ascend's own application, filled from what the CRM knows about a deal. The same sections are
 * used by the WhatsApp bot (signed by typed name) and by the deal page download (printed or
 * sent for signature, then uploaded back signed).
 */
export const ASCEND_BRAND = "Ascend Fund";
export const APPLICATION_TITLE = "Funding Application";

/** Header, intro and footer of every Ascend application PDF (same look as ascendfund.co). */
export const APPLICATION_PDF = {
  brand: ASCEND_BRAND,
  tagline: "Business Capital",
  title: APPLICATION_TITLE,
  intro:
    "Thank you for placing your trust in Ascend Fund Business Capital. Please review the information below.",
  contact: "786-565-0570 | www.ascendfund.co",
};

/** Merchant name a deal has while its uploaded application is still being read. */
export const READING_PLACEHOLDER = "New application (reading…)";

/**
 * Authorization printed above the signature (the Terms of use on ascendfund.co's application).
 * Settings → Ascend application can replace it.
 */
export const SIGNATURE_CONSENT =
  "By submitting this application, the above listed business and business owner/officer authorize Ascend Fund LLC dba Ascend Fund Business Capital and each of its representatives, successors, assigns, designees to obtain consumer or personal, business and investigative reports and other information about you, including credit card processor statements and bank statements, from one or more consumer reporting agencies. You also authorize Ascend Fund to transmit this application form, along with any of the foregoing information obtained in connection with this application any all of the Recipients for the foregoing purposes. You consent to the release, by any creditor or financial institution, of any information relating to any of you. You may revoke your consent to receive communications from us at any time by contacting us at funding@ascendfund.co or 786-565-0570.";

export interface OwnerPii {
  ssn: string | null;
  dob: string | null;
}

/** 2021-04-01 → 04/01/2021, the way lenders read dates. */
export const usDate = (v: string | undefined | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (v ?? null);
};

const show = (key: string, d: Draft) => {
  const f = FIELDS.find((x) => x.key === key)!;
  return f.show(f.get(d)) || null;
};

/**
 * Ascend's application sections, field for field as on ascendfund.co's application: business
 * information (with the amounts) and owner information. No email or phone.
 */
export function applicationSections(
  draft: Draft,
  pii: OwnerPii[],
  opts: { masked: boolean },
): ApplicationPdfSection[] {
  const b = draft.business;
  const sections: ApplicationPdfSection[] = [
    {
      heading: "Business information",
      fields: [
        ["Legal Company Name", b.legalName ?? null],
        ...(b.dba ? ([["Doing Business As", b.dba]] as [string, string][]) : []),
        ["Entity Type", show("business.entityType", draft)],
        ["Business Start Date", usDate(b.startDate)],
        ["Tax ID / EIN", b.ein ?? null],
        ["Industry", b.industry ?? null],
        ["Business Address", b.address?.line1 ?? null],
        ["City", b.address?.city ?? null],
        ["State", b.address?.state ?? null],
        ["ZIP", b.address?.postalCode ?? null],
        ["Financing Amount", show("request.amount", draft)],
        ["Monthly Revenue", show("request.monthlyRevenue", draft)],
      ],
    },
  ];
  draft.owners.forEach((o, i) => {
    const p = pii[i];
    sections.push({
      heading: i === 0 ? "Owner information" : `Owner ${i + 1} information`,
      fields: [
        ["Full Name", `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || null],
        ["Date of Birth", p?.dob ? (opts.masked ? "On file" : usDate(p.dob)) : null],
        ["Ownership %", o.ownershipPct !== undefined ? `${o.ownershipPct}%` : null],
        [
          "Social Security No.",
          p?.ssn ? (opts.masked ? `***-**-${p.ssn.slice(-4)}` : p.ssn) : null,
        ],
        ["Address", o.address?.line1 ?? null],
        ["City", o.address?.city ?? null],
        ["State", o.address?.state ?? null],
        ["ZIP", o.address?.postalCode ?? null],
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

/** What Ascend's application needs before it goes to lenders (as on ascendfund.co's form). */
const REQUIRED = [
  "business.legalName",
  "business.entityType",
  "business.ein",
  "business.startDate",
  "business.industry",
  "business.address",
  "request.amount",
  "owners.0.name",
  "owners.0.ownershipPct",
  "owners.0.address",
];

/** Required application fields the deal is still missing (labels for the deal page). */
export function missingFields(draft: Draft, pii: OwnerPii[]): string[] {
  const empty = (v: unknown) => v === undefined || v === null || v === "";
  const out = FIELDS.filter((f) => REQUIRED.includes(f.key) && empty(f.get(draft))).map(
    (f) => f.label.en,
  );
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
    ...APPLICATION_PDF,
    sections: applicationSections(app.draft, app.pii, { masked: false }),
    consentText: await signatureConsent(prisma, tenantId),
    signerName:
      `${app.draft.owners[0]?.firstName ?? ""} ${app.draft.owners[0]?.lastName ?? ""}`.trim() ||
      undefined,
    date: new Date(),
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
