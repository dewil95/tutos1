import { getPrisma, purgeTenant, type PrismaClient } from "@mca/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseReady } from "./testDb";

// Synthetic merchant only: what the AI "read" from the uploaded application.
const READING = {
  isApplication: true,
  business: {
    legalName: "Sample Grill LLC",
    dba: null,
    entityType: "LLC",
    ein: "11-2223333",
    startDate: "2019-03-01",
    industry: "Restaurant",
    naics: null,
    phone: "305-555-0142",
    email: "hello@samplegrill.test",
    website: null,
    addressLine1: "9 Ocean Dr",
    city: "Miami",
    state: "FL",
    postalCode: "33139",
  },
  request: {
    requestedAmount: 30000,
    useOfFunds: "Payroll",
    statedMonthlyRevenue: 52000,
    existingAdvances: [],
  },
  owners: [
    {
      firstName: "Robin",
      lastName: "Sample",
      ownershipPct: 100,
      ssn: null,
      dob: null,
      email: "robin@samplegrill.test",
      phone: null,
      addressLine1: "4 Palm Ave",
      city: "Miami",
      state: "FL",
      postalCode: "33140",
      creditScoreStated: null,
    },
  ],
  signed: false,
  signatureDate: null,
  lowConfidenceFields: [],
  confidence: 0.9,
};

vi.mock("@mca/ai", async (orig) => ({
  ...(await orig<typeof import("@mca/ai")>()),
  runApplicationReading: vi.fn(async () => ({ data: READING, record: {} })),
}));
vi.mock("./ai", () => ({ llmClient: () => ({ provider: "gemini", structured: vi.fn() }) }));
const uploads = vi.hoisted(() => [] as { fileName: string; data: Buffer }[]);
vi.mock("./google", async (orig) => ({
  ...(await orig<typeof import("./google")>()),
  tenantMailbox: async () => ({
    drive: {
      ensureFolderPath: async (path: string[]) => `folder-${path.join("/")}`,
      upload: async (file: { fileName: string; data: Buffer }) => {
        uploads.push(file);
        return { id: `file-${uploads.length}`, webViewLink: null };
      },
      download: async () => Buffer.from("%PDF-1.7"),
      rename: async () => undefined,
    },
  }),
}));

const {
  createWebApplication,
  findWebApplication,
  hashToken,
  merchantCopy,
  publicStartAllowed,
  reviewSnapshot,
  signWebApplication,
  startPublicApplication,
  STARTS_PER_IP_HOUR,
} = await import("./webApplication");
const { parseAdvanceLines, writeApplicationForm } = await import("./applicationForm");
const { handleApplicationRead } = await import("./jobs/applicationRead");

const KEY = Buffer.alloc(32, 5).toString("base64");
// A real (tiny) PNG, as the signing page sends the drawn signature.
const DRAWING =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("advances typed by the merchant", () => {
  it("reads company and balance per line", () => {
    expect(parseAdvanceLines("ABC Funding $8,000\nXYZ Capital: 12000.50\nSome Lender")).toEqual([
      { funder: "ABC Funding", balance: 8000 },
      { funder: "XYZ Capital", balance: 12000.5 },
      { funder: "Some Lender" },
    ]);
    expect(parseAdvanceLines("  \n")).toEqual([]);
    expect(parseAdvanceLines(null)).toEqual([]);
  });
});

describe.runIf(await databaseReady())("merchant application page (SQLite)", () => {
  let prisma: PrismaClient;
  let tenantId: string;

  beforeAll(async () => {
    process.env.PII_ENCRYPTION_KEY = KEY;
    prisma = getPrisma();
    tenantId = (
      await prisma.tenant.create({ data: { name: "Web Apply", slug: `web-${Date.now()}` } })
    ).id;
  });
  afterAll(async () => {
    await purgeTenant(prisma, tenantId);
  });

  const start = (ip: string | null = "203.0.113.7") =>
    startPublicApplication(prisma, {
      tenantId,
      application: { fileName: "other-co.pdf", data: Buffer.from(`%PDF-1.7 ${Math.random()}`) },
      statements: [
        { name: "march.pdf", type: "application/pdf", data: Buffer.from(`%PDF ${Math.random()}`) },
      ],
      email: "robin@samplegrill.test",
      phone: "305-555-0150",
      lang: "en",
      ip,
    });

  async function readNow(dealId: string) {
    const doc = await prisma.document.findFirstOrThrow({
      where: { dealId, type: "APPLICATION", internalOnly: true },
    });
    const job = await prisma.job.findUniqueOrThrow({ where: { dedupeKey: `appread:${doc.id}` } });
    await handleApplicationRead(prisma, { ...job, payload: job.payload } as never);
  }

  /** The details form as the merchant submits it, with SSN and date of birth added. */
  async function completeDetails(dealId: string) {
    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: dealId },
      include: { merchant: { include: { owners: true } } },
    });
    const f = new FormData();
    const set = (k: string, v: string) => f.set(k, v);
    set("legalName", "Sample Grill LLC");
    set("entityType", "LLC");
    set("ein", "11-2223333");
    set("startDate", "2019-03-01");
    set("industry", "Restaurant");
    set("line1", "9 Ocean Dr");
    set("city", "Miami");
    set("state", "FL");
    set("postalCode", "33139");
    set("email", "hello@samplegrill.test");
    set("amount", "30000");
    set("monthlyRevenue", "52000");
    set("advances", "ABC Funding $8,000");
    set("ownerId-0", deal.merchant.owners[0]!.id);
    set("firstName-0", "Robin");
    set("lastName-0", "Sample");
    set("pct-0", "100");
    set("ssn-0", "123-45-6789");
    set("dob-0", "1984-05-06");
    set("line1-0", "4 Palm Ave");
    set("city-0", "Miami");
    set("state-0", "FL");
    set("postalCode-0", "33140");
    await writeApplicationForm(prisma, deal, f, { advances: true });
  }

  it("starts a deal from the public page and never joins it to an existing merchant", async () => {
    // A business with the same name and EIN already in the CRM must stay private.
    const existing = await prisma.merchant.create({
      data: { tenantId, legalName: "Sample Grill LLC", einLast4: "3333" },
    });
    const { token, dealId } = await start();
    await readNow(dealId);
    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: dealId },
      include: { merchant: true },
    });
    expect(deal.merchantId).not.toBe(existing.id);
    expect(deal.merchant.legalName).toBe("Sample Grill LLC");
    expect(deal.source).toBe("web_apply");
    expect(deal.stage).toBe("DOCS_RECEIVED");
    const row = await findWebApplication(prisma, token);
    expect(row?.dealId).toBe(dealId);
    // Only the hash is stored.
    expect(row?.hashedToken).toBe(hashToken(token));
    expect(await prisma.webApplication.count({ where: { hashedToken: token } })).toBe(0);
  });

  it("refuses unknown, malformed and expired links", async () => {
    expect(await findWebApplication(prisma, "x")).toBeNull();
    expect(await findWebApplication(prisma, "a".repeat(32))).toBeNull();
    const { dealId } = await start(null);
    const token = await createWebApplication(prisma, { tenantId, dealId, origin: "team" });
    const later = new Date(Date.now() + 15 * 24 * 3_600_000);
    expect(await findWebApplication(prisma, token)).not.toBeNull();
    expect(await findWebApplication(prisma, token, later)).toBeNull();
  });

  it("limits how many applications one connection can start", async () => {
    const ip = "198.51.100.23";
    for (let i = 0; i < STARTS_PER_IP_HOUR; i++) {
      expect(await publicStartAllowed(prisma, ip)).toBe(true);
      await start(ip);
    }
    expect(await publicStartAllowed(prisma, ip)).toBe(false);
    expect(await publicStartAllowed(prisma, "198.51.100.24")).toBe(true);
  });

  it("signs only the version the merchant reviewed, with agreement and their own name", async () => {
    const { token, dealId } = await start("192.0.2.10");
    await readNow(dealId);
    const before = await reviewSnapshot(prisma, (await findWebApplication(prisma, token))!);
    // Read from the upload: SSN and date of birth are still missing.
    expect(before!.missing).toEqual(["Owner SSN", "Owner date of birth"]);
    const sign = (over: Partial<Parameters<typeof signWebApplication>[2]> = {}) =>
      signWebApplication(prisma, token, {
        name: "Robin Sample",
        agreed: true,
        drawing: DRAWING,
        fingerprint: before!.fingerprint,
        ip: "192.0.2.10",
        userAgent: "test-browser",
        ...over,
      });
    expect(await sign()).toEqual({ ok: false, error: "missing" });

    await completeDetails(dealId);
    // Signing what was reviewed before the details changed is refused.
    expect(await sign()).toEqual({ ok: false, error: "changed" });
    const snap = (await reviewSnapshot(prisma, (await findWebApplication(prisma, token))!))!;
    expect(snap.missing).toEqual([]);
    expect(snap.fingerprint).not.toBe(before!.fingerprint);
    // The review shows SSN masked; the PDF for lenders has it in full.
    const owner = snap.masked.find((s) => s.heading === "Owner")!;
    expect(owner.fields).toContainEqual(["Social Security number", "***-**-6789"]);
    const business = snap.masked.find((s) => s.heading === "Business")!;
    expect(business.fields.find(([k]) => /EIN/.test(k))?.[1]).toBe("**-***3333");
    expect(snap.full.find((s) => s.heading === "Business")!.fields).toContainEqual(
      expect.arrayContaining(["11-2223333"]),
    );

    const fp = snap.fingerprint;
    expect(await sign({ fingerprint: fp, agreed: false })).toEqual({ ok: false, error: "agree" });
    expect(await sign({ fingerprint: fp, name: "Someone Else" })).toEqual({
      ok: false,
      error: "name",
    });
    expect(await sign({ fingerprint: fp, drawing: null })).toEqual({ ok: false, error: "drawing" });
    expect(await sign({ fingerprint: fp, drawing: "data:image/png;base64,AAAA" })).toEqual({
      ok: false,
      error: "drawing",
    });
    const signed = await sign({ fingerprint: fp, name: "  robin   SAMPLE " });
    expect(signed.ok).toBe(true);
    expect(await sign({ fingerprint: fp })).toEqual({ ok: false, error: "signed" });

    const doc = await prisma.document.findFirstOrThrow({
      where: { dealId, type: "APPLICATION", internalOnly: false },
    });
    expect(doc.fileName).toBe("Ascend-Fund-Application-Sample-Grill-LLC.pdf");
    const sig = await prisma.applicationSignature.findFirstOrThrow({ where: { dealId } });
    expect(sig).toMatchObject({
      channel: "web",
      signerName: "robin SAMPLE",
      ownerName: "Robin Sample",
      ipAddress: "192.0.2.10",
      userAgent: "test-browser",
      documentId: doc.id,
    });
    expect(sig.consentText).toContain("electronic signature");
    expect(sig.signatureImage).toBe(DRAWING.split(",")[1]);
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(deal.submissionPositions).toEqual([{ funder: "ABC Funding", balance: 8000 }]);
    expect(deal.applicationData).toMatchObject({ signed: true, signedVia: "web" });
    expect(await prisma.dealEvent.count({ where: { dealId, type: "application_signed" } })).toBe(1);

    const row = (await findWebApplication(prisma, token))!;
    expect(row.signedAt).not.toBeNull();
    const copy = await merchantCopy(prisma, row);
    expect(copy?.data.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("keeps the merchant out of other deals' records", async () => {
    const a = await start("192.0.2.20");
    const b = await start("192.0.2.21");
    await readNow(a.dealId);
    await readNow(b.dealId);
    const rowA = (await findWebApplication(prisma, a.token))!;
    const snapA = (await reviewSnapshot(prisma, rowA))!;
    expect(snapA.app.deal.id).toBe(a.dealId);
    expect(snapA.app.deal.merchantId).not.toBe(
      (await prisma.deal.findUniqueOrThrow({ where: { id: b.dealId } })).merchantId,
    );
  });
});
