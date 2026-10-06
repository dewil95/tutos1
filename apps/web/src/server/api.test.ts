import { decryptSecret, getPrisma, purgeTenant, type PrismaClient } from "@mca/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as dealStatus } from "@/app/api/v1/deals/[id]/route";
import { applyApplication } from "./applicationData";
import { authenticateApi, generateApiKey, hashApiKey } from "./apiKeys";
import { databaseReady } from "./testDb";
import { ApplicationPayloadSchema, ingestApplication, payloadToReading } from "./websiteApi";

const KEY = Buffer.alloc(32, 9).toString("base64");

// Synthetic applicant; no real person or business.
const payload = {
  externalId: "web-1001",
  business: {
    legalName: "Sample Bistro LLC",
    dba: "Sample Bistro",
    entityType: "LLC",
    ein: "12-3456789",
    startDate: "2021-04-01",
    industry: "Restaurant",
    email: "Owner@SampleBistro.test",
    address: { line1: "1 Main St", city: "Miami", state: "fl", postalCode: "33101" },
  },
  request: {
    amount: 25000,
    useOfFunds: "Inventory",
    existingAdvances: [{ lender: "Sample Capital", balance: 9000 }],
  },
  owners: [
    {
      firstName: "Pat",
      lastName: "Example",
      ownershipPct: 100,
      ssn: "123-45-6789",
      dob: "1980-02-03",
    },
  ],
  signedAt: "2026-10-01T15:00:00Z",
};

describe("website payload", () => {
  it("accepts the documented shape and reports precise errors", () => {
    expect(ApplicationPayloadSchema.safeParse(payload).success).toBe(true);
    const bad = ApplicationPayloadSchema.safeParse({
      ...payload,
      owners: [{ firstName: "A", lastName: "B", ssn: "12" }],
    });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues[0]!.path.join(".")).toBe("owners.0.ssn");
  });

  it("maps to the same shape A5 produces", () => {
    const r = payloadToReading(ApplicationPayloadSchema.parse(payload));
    expect(r.business.state).toBe("fl");
    expect(r.request.existingAdvances).toEqual([{ lender: "Sample Capital", balance: 9000 }]);
    expect(r.signed).toBe(true);
  });

  it("generates keys that only match their own hash", () => {
    const k = generateApiKey();
    expect(k.key.startsWith("ak_live_")).toBe(true);
    expect(k.hashedKey).toBe(hashApiKey(k.key));
    expect(k.hashedKey).not.toBe(hashApiKey(generateApiKey().key));
  });
});

describe.runIf(await databaseReady())("website API (Postgres)", () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let key: string;

  beforeAll(async () => {
    process.env.PII_ENCRYPTION_KEY = KEY;
    prisma = getPrisma();
    tenantId = (
      await prisma.tenant.create({ data: { name: "API Test", slug: `api-test-${Date.now()}` } })
    ).id;
    const k = generateApiKey();
    key = k.key;
    await prisma.apiKey.create({
      data: { tenantId, name: "Website", prefix: k.prefix, hashedKey: k.hashedKey },
    });
  });

  afterAll(async () => {
    await purgeTenant(prisma, tenantId);
    await prisma.$disconnect();
  });

  const req = (auth?: string) =>
    new Request("http://x/api/v1/deals/web-1001", { headers: auth ? { authorization: auth } : {} });

  it("rejects missing, malformed and revoked keys", async () => {
    expect(((await authenticateApi(prisma, req())) as Response).status).toBe(401);
    expect(((await authenticateApi(prisma, req("Bearer nope"))) as Response).status).toBe(401);
    const k = generateApiKey();
    await prisma.apiKey.create({
      data: {
        tenantId,
        name: "Old",
        prefix: k.prefix,
        hashedKey: k.hashedKey,
        revokedAt: new Date(),
      },
    });
    expect(((await authenticateApi(prisma, req(`Bearer ${k.key}`))) as Response).status).toBe(401);
    expect(await authenticateApi(prisma, req(`Bearer ${key}`))).toMatchObject({ tenantId });
  });

  it("creates merchant, owners (encrypted) and deal once per externalId", async () => {
    const p = ApplicationPayloadSchema.parse(payload);
    const first = await ingestApplication(prisma, tenantId, p);
    expect(first.created).toBe(true);
    const again = await ingestApplication(prisma, tenantId, p);
    expect(again).toMatchObject({ created: false });
    expect(again.deal.id).toBe(first.deal.id);

    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: first.deal.id },
      include: { merchant: { include: { owners: true } } },
    });
    expect(deal).toMatchObject({
      source: "website",
      stage: "DOCS_REQUESTED",
      useOfFunds: "Inventory",
    });
    expect(Number(deal.requestedAmount)).toBe(25000);
    expect(deal.submissionPositions).toEqual([{ funder: "Sample Capital", balance: 9000 }]);
    expect(deal.merchant).toMatchObject({
      dba: "Sample Bistro",
      state: "FL",
      email: "owner@samplebistro.test",
      einLast4: "6789",
    });
    const owner = deal.merchant.owners[0]!;
    expect(owner).toMatchObject({ firstName: "Pat", ssnLast4: "6789", isPrimary: true });
    expect(owner.ssnEncrypted).not.toContain("6789");
    expect(decryptSecret(owner.ssnEncrypted!, KEY)).toBe("123-45-6789");
    expect(decryptSecret(owner.dobEncrypted!, KEY)).toBe("1980-02-03");
  });

  it("AI-read applications fill gaps but report differences instead of overwriting", async () => {
    const deal = await prisma.deal.findFirstOrThrow({
      where: { tenantId, externalRef: "web-1001" },
    });
    const reading = payloadToReading(ApplicationPayloadSchema.parse(payload));
    reading.business.phone = "305-555-0100"; // new info → filled
    reading.business.city = "Orlando"; // differs → conflict
    reading.owners[0]!.ssn = "999-99-1111"; // differs → conflict without exposing the number
    const conflicts = await applyApplication(
      prisma,
      { dealId: deal.id, merchantId: deal.merchantId },
      reading,
      "fill",
    );
    expect(conflicts.map((c) => c.field).sort()).toEqual([
      "merchant.city",
      "owner.Pat Example.ssn",
    ]);
    expect(conflicts.find((c) => c.field.endsWith("ssn"))).toMatchObject({
      current: "…6789",
      fromApplication: "…1111",
    });
    const m = await prisma.merchant.findUniqueOrThrow({ where: { id: deal.merchantId } });
    expect(m).toMatchObject({ phone: "305-555-0100", city: "Miami" });
  });

  it("reports status to the website without naming lenders", async () => {
    const res = await dealStatus(req(`Bearer ${key}`), {
      params: Promise.resolve({ id: "web-1001" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      externalId: "web-1001",
      stage: "DOCS_REQUESTED",
      lenders: { reviewing: 0, approved: 0, declined: 0 },
    });
    const other = await dealStatus(req(`Bearer ${key}`), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(other.status).toBe(404);
  });
});
