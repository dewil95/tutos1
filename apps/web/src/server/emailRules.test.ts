import { getPrisma, purgeTenant, type PrismaClient } from "@mca/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isWeekendNY, renderTemplate } from "./email/rules";
import { runEmailRules } from "./jobs/emailRules";
import { databaseReady } from "./testDb";

describe("templates", () => {
  it("fills placeholders and drops unknown ones instead of leaking braces", () => {
    expect(
      renderTemplate("Hi {{contact}}, re {{business}} {{typo}}", {
        contact: "Pat",
        business: "Sample",
      }),
    ).toBe("Hi Pat, re Sample ");
  });
  it("knows New York weekends", () => {
    expect(isWeekendNY(new Date("2026-10-10T15:00:00Z"))).toBe(true); // Saturday
    expect(isWeekendNY(new Date("2026-10-12T15:00:00Z"))).toBe(false); // Monday
  });
});

describe.runIf(await databaseReady())("email automation (Postgres, dry run)", () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let merchantId: string;
  let dealId: string;
  const monday = new Date("2026-10-12T15:00:00Z");
  const hoursAgo = (h: number) => new Date(monday.getTime() - h * 3_600_000);

  beforeAll(async () => {
    process.env.MCA_EMAIL_DRY_RUN = "true";
    prisma = getPrisma();
    tenantId = (
      await prisma.tenant.create({
        data: {
          name: "Ascend Test",
          slug: `rules-${Date.now()}`,
          fromAddress: "funding@ascendfund.co",
          teamCc: ["jonas@ascendfund.co"],
        },
      })
    ).id;
    const m = await prisma.merchant.create({
      data: { tenantId, legalName: "Sample Bistro LLC", email: "owner@samplebistro.test" },
    });
    merchantId = m.id;
    await prisma.owner.create({
      data: { merchantId, firstName: "Pat", lastName: "Example", isPrimary: true },
    });
    dealId = (
      await prisma.deal.create({
        data: { tenantId, merchantId, stage: "DOCS_REQUESTED", createdAt: hoursAgo(30) },
      })
    ).id;
  });

  afterAll(async () => {
    await purgeTenant(prisma, tenantId);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.merchant.update({ where: { id: merchantId }, data: { emailOptOut: false } });
  });

  const outbound = () =>
    prisma.activity.findMany({
      where: { dealId, direction: "OUTBOUND" },
      orderBy: { createdAt: "asc" },
    });

  it("asks for missing documents once per day, at most 3 times, and respects opt-out", async () => {
    const r1 = await runEmailRules(prisma, tenantId, monday);
    expect(r1.sent.map((s) => s.kind)).toEqual(["MISSING_DOCS"]);
    const [mail] = await outbound();
    expect(mail!.toAddress).toBe("To: owner@samplebistro.test");
    expect(mail!.body).toContain("Hi Pat,");
    expect(mail!.body).toContain("- Last 4 months of business bank statements");

    // Same tick again: nothing (24 h spacing).
    expect((await runEmailRules(prisma, tenantId, monday)).sent).toEqual([]);
    // Opted out: nothing even when due.
    await prisma.merchant.update({ where: { id: merchantId }, data: { emailOptOut: true } });
    expect(
      (await runEmailRules(prisma, tenantId, new Date(monday.getTime() + 25 * 3_600_000))).sent,
    ).toEqual([]);
  });

  it("chases stips in one email per deal and stops after the limit", async () => {
    await prisma.stipulation.createMany({
      data: [
        { dealId, name: "Voided check", createdAt: hoursAgo(26) },
        { dealId, name: "MTD statement", createdAt: hoursAgo(26) },
      ],
    });
    const at = (h: number) => new Date(monday.getTime() + h * 3_600_000);
    const sent: string[] = [];
    for (const h of [0, 1, 25, 50, 75, 100]) {
      sent.push(
        ...(await runEmailRules(prisma, tenantId, at(h))).sent
          .filter((s) => s.kind === "STIP_CHASE")
          .map((s) => s.kind),
      );
    }
    expect(sent).toHaveLength(3);
    const stips = await prisma.stipulation.findMany({ where: { dealId } });
    expect(stips.every((s) => s.chaseCount === 3 && s.status === "SENT_TO_MERCHANT")).toBe(true);
    const chase = (await outbound()).find((a) => a.subject?.includes("Items needed"))!;
    expect(chase.body).toContain("- Voided check\n- MTD statement");
  });

  it("follows up once with a quiet lender in its own thread, same To/CC, not on weekends", async () => {
    const funder = await prisma.funder.create({
      data: {
        tenantId,
        name: "Quiet Lender",
        submissionTo: "subs@quiet.test",
        submissionCc: ["iso@quiet.test"],
      },
    });
    await prisma.deal.update({ where: { id: dealId }, data: { stage: "SUBMITTED" } });
    await prisma.submission.create({
      data: {
        dealId,
        funderId: funder.id,
        channel: "EMAIL",
        status: "SENT",
        sentAt: hoursAgo(30),
        gmailThreadId: "thread-1",
        toAddresses: ["subs@quiet.test"],
        ccAddresses: ["iso@quiet.test", "jonas@ascendfund.co"],
      },
    });
    const saturday = new Date("2026-10-17T15:00:00Z");
    expect(
      (await runEmailRules(prisma, tenantId, saturday)).sent.filter(
        (s) => s.kind === "LENDER_FOLLOW_UP",
      ),
    ).toEqual([]);
    const r = await runEmailRules(prisma, tenantId, monday);
    expect(r.sent.filter((s) => s.kind === "LENDER_FOLLOW_UP")).toHaveLength(1);
    const again = await runEmailRules(prisma, tenantId, new Date("2026-10-14T15:00:00Z"));
    expect(again.sent.filter((s) => s.kind === "LENDER_FOLLOW_UP")).toEqual([]);
    const f = (await outbound()).find((a) => a.subject?.includes("Re: New Deal Submission"))!;
    expect(f.toAddress).toBe("To: subs@quiet.test | Cc: iso@quiet.test, jonas@ascendfund.co");
    expect(f.threadId).toBe("thread-1");
    expect(f.toAddress).not.toMatch(/bcc/i);
  });
});
