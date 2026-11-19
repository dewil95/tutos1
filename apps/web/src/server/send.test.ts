import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma, purgeTenant, type PrismaClient } from "@mca/db";
import { runDueJobs } from "./jobs/runner";
import { queueSubmissions } from "./submissions";
import { databaseReady } from "./testDb";

// End-to-end "ship the file" on a local D1 in dry-run mode (no Gmail).
const reachable = await databaseReady();

describe.runIf(reachable)("send to lenders (dry run)", () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let userId: string;
  let dealId: string;
  let docId: string;
  const funderIds: string[] = [];

  beforeAll(async () => {
    process.env.MCA_EMAIL_DRY_RUN = "true";
    prisma = getPrisma();
    const t = await prisma.tenant.create({
      data: {
        name: "Send Test",
        slug: `send-test-${Date.now()}`,
        fromAddress: "funding@ascendfund.co",
        teamCc: ["jonas@ascendfund.co", "savvy@ascendfund.co"],
      },
    });
    tenantId = t.id;
    userId = (
      await prisma.user.create({ data: { tenantId, email: "jonas@ascendfund.co", name: "Jonas" } })
    ).id;
    const merchant = await prisma.merchant.create({
      data: { tenantId, legalName: "Acme Pizza LLC" },
    });
    dealId = (await prisma.deal.create({ data: { tenantId, merchantId: merchant.id } })).id;
    docId = (
      await prisma.document.create({
        data: {
          tenantId,
          dealId,
          type: "APPLICATION",
          driveFileId: `drive-${Date.now()}`,
          fileName: "Ascend-Fund-Application-Acme.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1000,
          sha256: "x",
        },
      })
    ).id;
    for (const f of [
      {
        name: "Mazal",
        submissionTo: "subs@mazalfunders.com",
        submissionCc: ["iso@mazalfunders.com", "nate@mazalfunders.com"],
      },
      { name: "Zlur", submissionTo: "submissions@zlur.com", submissionCc: [] },
    ]) {
      funderIds.push((await prisma.funder.create({ data: { ...f, tenantId } })).id);
    }
  });

  afterAll(async () => {
    await purgeTenant(prisma, tenantId);
    await prisma.$disconnect();
  });

  it("creates one email per lender: To = first address, CC = the lender's others + team, no BCC", async () => {
    const plan = await queueSubmissions(prisma, {
      tenantId,
      userId,
      dealId,
      funderIds,
      documentIds: [docId],
      positions: [{ funder: "Fundzilla", balance: 8000 }],
      note: null,
    });
    expect(plan.jobIds).toHaveLength(2);
    const result = await runDueJobs(prisma, { budgetMs: 10_000, ids: plan.jobIds });
    expect(result.failed).toEqual([]);

    const subs = await prisma.submission.findMany({
      where: { dealId },
      include: { funder: true },
      orderBy: { createdAt: "asc" },
    });
    expect(subs.map((s) => [s.funder.name, s.status, s.toAddresses, s.ccAddresses])).toEqual([
      [
        "Mazal",
        "SENT",
        ["subs@mazalfunders.com"],
        [
          "iso@mazalfunders.com",
          "nate@mazalfunders.com",
          "jonas@ascendfund.co",
          "savvy@ascendfund.co",
        ],
      ],
      ["Zlur", "SENT", ["submissions@zlur.com"], ["jonas@ascendfund.co", "savvy@ascendfund.co"]],
    ]);

    // Each lender's copy carries its own watermark reference.
    const tags = subs.map((s) => s.watermarkTag);
    expect(tags.every((t) => /^[A-Z2-9]{8}$/.test(t ?? ""))).toBe(true);
    expect(new Set(tags).size).toBe(2);

    const emails = await prisma.activity.findMany({ where: { dealId, direction: "OUTBOUND" } });
    expect(emails).toHaveLength(2);
    for (const e of emails) {
      expect(e.subject).toBe("[DRY RUN] New Deal Submission - Acme Pizza LLC");
      expect(e.body).toContain("Fundzilla: $8,000");
      expect(e.toAddress).not.toMatch(/bcc/i);
      expect(e.body).toMatch(/Each PDF stamped for (Mazal|Zlur), ref [A-Z2-9]{8}/);
    }
    // Each lender's email names only that lender's addresses.
    expect(
      emails.filter(
        (e) => e.toAddress!.includes("zlur.com") && e.toAddress!.includes("mazalfunders.com"),
      ),
    ).toEqual([]);
  });

  it("blocks sending the same merchant to the same lender twice", async () => {
    const plan = await queueSubmissions(prisma, {
      tenantId,
      userId,
      dealId,
      funderIds: [funderIds[0]!],
      documentIds: [docId],
      positions: [],
      note: null,
    });
    expect(plan.jobIds).toEqual([]);
    expect(plan.skipped[0]?.reason).toMatch(/already submitted/);
  });

  it("leaves the stage alone when every lender was skipped", async () => {
    // A second deal for the same merchant: the lender already has the merchant.
    const merchantId = (await prisma.deal.findUniqueOrThrow({ where: { id: dealId } })).merchantId;
    const again = await prisma.deal.create({ data: { tenantId, merchantId } });
    const signed = await prisma.document.create({
      data: {
        tenantId,
        dealId: again.id,
        type: "APPLICATION",
        driveFileId: `drive-again-${Date.now()}`,
        fileName: "Ascend-Fund-Application-Acme-signed.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1000,
        sha256: "z",
      },
    });
    const plan = await queueSubmissions(prisma, {
      tenantId,
      userId,
      dealId: again.id,
      funderIds: [funderIds[0]!],
      documentIds: [signed.id],
      positions: [],
      note: null,
    });
    expect(plan.submissionIds).toEqual([]);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: again.id } })).stage).toBe("INTAKE");
  });

  it("refuses to send the unsigned Ascend application the CRM generated", async () => {
    const merchant = await prisma.merchant.create({ data: { tenantId, legalName: "Beta Tacos" } });
    const deal = await prisma.deal.create({ data: { tenantId, merchantId: merchant.id } });
    const generated = await prisma.document.create({
      data: {
        tenantId,
        dealId: deal.id,
        type: "APPLICATION",
        uploadedVia: "generated",
        driveFileId: `drive-gen-${Date.now()}`,
        fileName: "Ascend-Fund-Application-Beta-Tacos.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1000,
        sha256: "y",
      },
    });
    await expect(
      queueSubmissions(prisma, {
        tenantId,
        userId,
        dealId: deal.id,
        funderIds: [funderIds[1]!],
        documentIds: [generated.id],
        positions: [],
        note: null,
      }),
    ).rejects.toThrow(/not signed yet/);
    expect(await prisma.submission.count({ where: { dealId: deal.id } })).toBe(0);
  });

  it("rejects a send when any selected lender has no address, before queueing anything", async () => {
    const bad = await prisma.funder.create({
      data: { tenantId, name: "No Email Lender", submissionCc: [] },
    });
    const zlurLike = await prisma.funder.create({
      data: { tenantId, name: "Other", submissionTo: "uw@other.com", submissionCc: [] },
    });
    await expect(
      queueSubmissions(prisma, {
        tenantId,
        userId,
        dealId,
        funderIds: [zlurLike.id, bad.id],
        documentIds: [docId],
        positions: [],
        note: null,
      }),
    ).rejects.toThrow(/no submission email/);
    expect(await prisma.submission.count({ where: { funderId: zlurLike.id } })).toBe(0);
  });
});
