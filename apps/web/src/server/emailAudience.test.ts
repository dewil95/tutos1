import { getPrisma, purgeTenant, type PrismaClient } from "@mca/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseReady } from "./testDb";

const sent = vi.hoisted(() => [] as { to: string[] }[]);
vi.mock("./google", async (orig) => ({
  ...(await orig<typeof import("./google")>()),
  tenantMailbox: async () => ({
    gmail: {
      send: async (m: { to: string[] }) => {
        sent.push(m);
        return { messageId: `m${sent.length}`, threadId: `t${sent.length}` };
      },
    },
  }),
}));

const { sendTracked } = await import("./email/send");
const { emailDryRun, merchantEmailsOff } = await import("./env");

describe("who an email may go to", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env.MCA_EMAIL_DRY_RUN = env.MCA_EMAIL_DRY_RUN;
    process.env.MERCHANT_EMAILS = env.MERCHANT_EMAILS;
  });

  it("keeps merchant emails off unless both switches are on", () => {
    process.env.MCA_EMAIL_DRY_RUN = "false";
    delete process.env.MERCHANT_EMAILS;
    expect(emailDryRun()).toBe(false);
    expect(merchantEmailsOff()).toBe(true);
    process.env.MERCHANT_EMAILS = "on";
    expect(merchantEmailsOff()).toBe(false);
    process.env.MCA_EMAIL_DRY_RUN = "true";
    expect(merchantEmailsOff()).toBe(true);
  });
});

describe.runIf(await databaseReady())("sending with lender emails live (SQLite)", () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let dealId: string;

  beforeAll(async () => {
    process.env.MCA_EMAIL_DRY_RUN = "false";
    delete process.env.MERCHANT_EMAILS;
    prisma = getPrisma();
    tenantId = (
      await prisma.tenant.create({ data: { name: "Audience", slug: `aud-${Date.now()}` } })
    ).id;
    const merchant = await prisma.merchant.create({
      data: { tenantId, legalName: "Sample Bistro LLC" },
    });
    dealId = (await prisma.deal.create({ data: { tenantId, merchantId: merchant.id } })).id;
  });
  afterAll(async () => {
    process.env.MCA_EMAIL_DRY_RUN = "true";
    await purgeTenant(prisma, tenantId);
  });

  const email = (audience: "lender" | "merchant", to: string) => ({
    tenantId,
    dealId,
    kind: "TEST",
    target: to,
    from: "jonas@ascendfund.co",
    to: [to],
    cc: [],
    subject: "Test",
    text: "Test",
    audience,
  });

  it("sends to a lender, but only logs an email to the merchant", async () => {
    const lender = await sendTracked(prisma, email("lender", "uw@lender.test"));
    const merchant = await sendTracked(prisma, email("merchant", "owner@samplebistro.test"));
    expect(lender.dryRun).toBe(false);
    expect(merchant.dryRun).toBe(true);
    expect(sent.map((m) => m.to[0])).toEqual(["uw@lender.test"]);
    // Both are on the deal timeline; the merchant one is marked as not sent.
    const activities = await prisma.activity.findMany({
      where: { dealId },
      orderBy: { id: "asc" },
    });
    expect(activities.map((a) => a.subject).sort()).toEqual(["Test", "[DRY RUN] Test"].sort());
  });
});
