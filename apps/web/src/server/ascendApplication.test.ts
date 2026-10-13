import { decryptSecret, getPrisma, purgeTenant, type PrismaClient } from "@mca/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseReady } from "./testDb";

// Synthetic merchant only: "another company's" application as a mocked A5 reading.
const READING = {
  isApplication: true,
  business: {
    legalName: "Sample Tacos LLC",
    dba: "Sample Tacos",
    entityType: "LLC",
    ein: "98-7654321",
    startDate: "2020-06-15",
    industry: "Restaurant",
    naics: null,
    phone: "305-555-0199",
    email: "hello@sampletacos.test",
    website: null,
    addressLine1: "5 Bay Rd",
    city: "Miami",
    state: "FL",
    postalCode: "33130",
  },
  request: {
    requestedAmount: 25000,
    useOfFunds: "Equipment",
    statedMonthlyRevenue: 48000,
    existingAdvances: [{ lender: "Sample Capital", balance: 7000 }],
  },
  owners: [
    {
      firstName: "Lee",
      lastName: "Sample",
      ownershipPct: 100,
      ssn: "123-45-6789",
      dob: "1985-01-02",
      email: "lee@sampletacos.test",
      phone: null,
      addressLine1: "8 Pine St",
      city: "Miami",
      state: "FL",
      postalCode: "33131",
      creditScoreStated: 650,
    },
  ],
  signed: true,
  signatureDate: "2026-10-01",
  lowConfidenceFields: [],
  confidence: 0.92,
};

const reading = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@mca/ai", async (orig) => ({
  ...(await orig<typeof import("@mca/ai")>()),
  runApplicationReading: vi.fn(async () => ({ data: reading.current, record: {} })),
}));
vi.mock("./ai", () => ({ llmClient: () => ({ provider: "gemini", structured: vi.fn() }) }));
vi.mock("./google", async (orig) => ({
  ...(await orig<typeof import("./google")>()),
  tenantMailbox: async () => ({ drive: { download: async () => Buffer.from("%PDF-1.7") } }),
}));

const {
  READING_PLACEHOLDER,
  applicationFileBase,
  applicationUploadToPdf,
  dealApplication,
  missingFields,
  renderDealApplication,
} = await import("./ascendApplication");
const { handleApplicationRead } = await import("./jobs/applicationRead");
const { defaultPackage } = await import("./documents");

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("Ascend application helpers", () => {
  it("names the file the way lenders know it", () => {
    expect(applicationFileBase("Joe's Pizza & Grill")).toBe(
      "Ascend-Fund-Application-Joe-s-Pizza-Grill",
    );
    expect(applicationFileBase(null)).toBe("Ascend-Fund-Application-Merchant");
  });

  it("takes one PDF as is, joins page photos, and refuses a mix", async () => {
    const pdf = { name: "app.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.7") };
    expect((await applicationUploadToPdf([pdf])).data).toBe(pdf.data);
    await expect(applicationUploadToPdf([pdf, pdf])).rejects.toThrow(/one application PDF/);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const photos = await applicationUploadToPdf([
      { name: "p1.png", type: "image/png", data: png },
      { name: "p2.png", type: "image/png", data: png },
    ]);
    expect(photos.fileName).toBe("Application photos (2 pages).pdf");
    expect(photos.data.subarray(0, 5).toString()).toBe("%PDF-");
    await expect(
      applicationUploadToPdf([pdf, { name: "p.png", type: "image/png", data: png }]),
    ).rejects.toThrow(/not both/);
    await expect(
      applicationUploadToPdf([{ name: "a.docx", type: "application/msword", data: png }]),
    ).rejects.toThrow(/PDF, or JPG\/PNG/);
  });

  it("lists what the application still needs", () => {
    expect(
      missingFields({ business: {}, request: {}, owners: [{}] }, [{ ssn: null, dob: null }]),
    ).toEqual(expect.arrayContaining(["Amount requested", "Owner SSN", "Owner date of birth"]));
  });
});

describe.runIf(await databaseReady())("upload → Ascend application → signed copy", () => {
  let prisma: PrismaClient;
  let tenantId: string;

  beforeAll(async () => {
    process.env.PII_ENCRYPTION_KEY = KEY;
    prisma = getPrisma();
    tenantId = (
      await prisma.tenant.create({ data: { name: "App Test", slug: `app-${Date.now()}` } })
    ).id;
  });
  afterAll(async () => {
    await purgeTenant(prisma, tenantId);
  });

  async function uploadedDeal() {
    const merchant = await prisma.merchant.create({
      data: { tenantId, legalName: READING_PLACEHOLDER },
    });
    const deal = await prisma.deal.create({
      data: { tenantId, merchantId: merchant.id, source: "application_upload" },
    });
    const doc = await prisma.document.create({
      data: {
        tenantId,
        dealId: deal.id,
        merchantId: merchant.id,
        type: "APPLICATION",
        internalOnly: true,
        driveFileId: `drive-${deal.id}`,
        fileName: "Other Co application.pdf",
        mimeType: "application/pdf",
        sizeBytes: 8,
        sha256: deal.id,
        uploadedVia: "staff",
      },
    });
    const job = (documentId: string) => ({
      id: "job",
      tenantId,
      type: "APPLICATION_READ" as const,
      payload: { documentId, newDeal: true },
      attempts: 1,
      maxAttempts: 5,
    });
    return { merchant, deal, doc, job };
  }

  it("fills the deal from the other company's form and renders Ascend's application", async () => {
    reading.current = READING;
    const { merchant, deal, doc, job } = await uploadedDeal();
    expect(missingFields(...(await draftOf(deal.id)))).toContain("Business legal name");

    await handleApplicationRead(prisma, job(doc.id));

    const m = await prisma.merchant.findUniqueOrThrow({
      where: { id: merchant.id },
      include: { owners: true },
    });
    expect(m).toMatchObject({ legalName: "Sample Tacos LLC", dba: "Sample Tacos", state: "FL" });
    expect(decryptSecret(m.owners[0]!.ssnEncrypted!, KEY)).toBe("123-45-6789");
    const d = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(Number(d.requestedAmount)).toBe(25000);
    expect(Number(d.statedMonthlyRevenue)).toBe(48000);
    expect(d.applicationData).toMatchObject({ documentId: doc.id, fromOtherCompany: true });
    // The other company's form stays team-only.
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).internalOnly).toBe(
      true,
    );

    const app = (await dealApplication(prisma, tenantId, deal.id))!;
    expect(missingFields(app.draft, app.pii)).toEqual([]);
    expect(app.draft.request.existingAdvances).toEqual([
      { lender: "Sample Capital", balance: 7000 },
    ]);

    const pdf = (await renderDealApplication(prisma, tenantId, deal.id))!;
    expect(pdf.fileName).toBe("Ascend-Fund-Application-Sample-Tacos.pdf");
    expect(pdf.data.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await renderDealApplication(prisma, "other-tenant", deal.id)).toBeNull();

    // Only the signed Ascend copy is packaged for lenders, never the other company's form.
    const docs = await prisma.document.findMany({ where: { dealId: deal.id } });
    expect(defaultPackage(docs)).toEqual([]);
    const signed = await prisma.document.create({
      data: {
        tenantId,
        dealId: deal.id,
        merchantId: merchant.id,
        type: "APPLICATION",
        driveFileId: "drive-signed",
        fileName: pdf.fileName,
        mimeType: "application/pdf",
        sizeBytes: pdf.data.length,
        sha256: `signed-${deal.id}`,
        uploadedVia: "staff",
      },
    });
    expect(defaultPackage([...docs, signed])).toEqual([signed.id]);
  });

  it("moves a returning merchant's new deal onto their record", async () => {
    reading.current = READING;
    const first = await prisma.merchant.findFirstOrThrow({
      where: { tenantId, legalName: "Sample Tacos LLC" },
    });
    reading.current = {
      ...READING,
      business: { ...READING.business, phone: "305-555-0000" },
    };
    const { merchant, deal, doc, job } = await uploadedDeal();
    await handleApplicationRead(prisma, job(doc.id));

    const d = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(d.merchantId).toBe(first.id);
    expect(await prisma.merchant.findUnique({ where: { id: merchant.id } })).toBeNull();
    // What the CRM already had wins; the difference waits for a person.
    expect((await prisma.merchant.findUniqueOrThrow({ where: { id: first.id } })).phone).toBe(
      "305-555-0199",
    );
    expect(d.applicationData).toMatchObject({
      conflicts: [
        expect.objectContaining({ field: "merchant.phone", fromApplication: "305-555-0000" }),
      ],
    });
  });

  it("marks a file that is not an application", async () => {
    reading.current = { ...READING, isApplication: false, owners: [] };
    const { deal, doc, job } = await uploadedDeal();
    await handleApplicationRead(prisma, job(doc.id));
    expect(
      (await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).applicationData,
    ).toMatchObject({ notAnApplication: true });
  });

  async function draftOf(dealId: string) {
    const app = (await dealApplication(prisma, tenantId, dealId))!;
    return [app.draft, app.pii] as const;
  }
});
