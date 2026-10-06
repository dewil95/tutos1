import { getPrisma, purgeTenant, type PrismaClient } from "@mca/db";
import { computeBankMetrics, scrubStatements, type ScrubRow } from "@mca/domain";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseReady } from "./testDb";

// The narrative is the only AI part; numbers must come from code even when the model is mocked.
vi.mock("@mca/ai", async (orig) => ({
  ...(await orig<typeof import("@mca/ai")>()),
  runRiskNarrative: vi.fn(async (_client: unknown, input: { facts: unknown }) => {
    (globalThis as { __facts?: unknown }).__facts = input.facts;
    return {
      data: {
        headline: "Second position restaurant, clean balances, one new advance in August",
        summary: "Summary.",
        topRisks: [
          { title: "New funding", detail: "Wire of $15,000 in 2026-08", severity: "high" },
        ],
        mitigants: ["Steady deposits"],
        questionsForMerchant: ["What was the $15,000 wire on 08/20?"],
        lenderStrategy: "Start with second-position lenders.",
        confidence: 0.8,
      },
      record: {},
      raw: null,
    };
  }),
}));
vi.mock("./ai", () => ({ llmClient: () => ({ provider: "gemini", structured: vi.fn() }) }));

const { handleRiskReport } = await import("./jobs/riskReport");
const { queueSubmissions } = await import("./submissions");

describe.runIf(await databaseReady())("AI Risk Report (Postgres)", () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let dealId: string;

  beforeAll(async () => {
    prisma = getPrisma();
    tenantId = (
      await prisma.tenant.create({
        data: { name: "Risk Test", slug: `risk-${Date.now()}`, teamCc: [] },
      })
    ).id;
    const merchant = await prisma.merchant.create({
      data: {
        tenantId,
        legalName: "Sample Bistro LLC",
        state: "FL",
        startDate: new Date("2020-01-01"),
      },
    });
    dealId = (
      await prisma.deal.create({
        data: { tenantId, merchantId: merchant.id, requestedAmount: 25000 },
      })
    ).id;
    let bal = 10_000;
    const rows: ScrubRow[] = ["2026-05", "2026-06", "2026-07", "2026-08"].map((m) => {
      const r: ScrubRow = {
        month: m,
        accountLast4: "1234",
        beginningBalance: bal,
        endingBalance: bal + 2_000,
        totalDeposits: 50_000,
        depositCount: 60,
        totalWithdrawals: 48_000,
        nonRevenueDeposits: 0,
        averageDailyBalance: 6_000,
        nsfCount: 0,
        overdraftFeeCount: 0,
        negativeDays: 0,
        minDailyBalance: 1_000,
        isComplete: true,
      };
      bal += 2_000;
      return r;
    });
    rows[3]!.nonRevenueDepositNotes = ["08/20 WIRE SAMPLE CAPITAL FUNDING 15,000.00"];
    const report = scrubStatements(rows);
    await prisma.bankAnalysis.create({
      data: {
        dealId,
        documentIds: [],
        monthlyRows: rows as never,
        metrics: computeBankMetrics(rows) as never,
        paperGrade: "B",
        scrub: {
          report,
          files: [
            {
              fileName: "June.pdf",
              metadataFlags: [{ message: "Last saved with Acrobat Pro" }],
              visualFindings: [],
            },
          ],
        } as never,
      },
    });
    await prisma.position.create({
      data: {
        dealId,
        descriptor: "SAMPLE CAP ACH",
        funderGuess: "Sample Capital",
        frequency: "daily",
        paymentAmount: 400,
        confidence: 0.9,
      },
    });
    await prisma.funder.create({
      data: {
        tenantId,
        name: "Second Pos Lender",
        submissionTo: "uw@second.test",
        submissionCc: [],
      },
    });
  });

  afterAll(async () => {
    await purgeTenant(prisma, tenantId);
    await prisma.$disconnect();
  });

  it("stores a code-computed score with the AI narrative, without owner PII in the prompt", async () => {
    await handleRiskReport(prisma, {
      id: "j",
      tenantId,
      type: "RISK_REPORT",
      payload: { dealId },
      attempts: 1,
      maxAttempts: 5,
    });
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
    const r = deal.riskReport as {
      risk: { score: number; deductions: { reason: string }[] };
      narrative: { headline: string };
      lenders: { name: string }[];
      integrityIssues: string[];
      pdfDocumentId: string | null;
    };
    expect(r.risk.score).toBeLessThan(100);
    expect(r.risk.deductions.map((d) => d.reason)).toEqual(
      expect.arrayContaining([
        "1 critical scrub flag(s)",
        "1 document integrity hint(s)",
        "1 active position(s)",
      ]),
    );
    expect(r.narrative.headline).toContain("Second position");
    expect(r.lenders.map((l) => l.name)).toEqual(["Second Pos Lender"]);
    expect(r.integrityIssues[0]).toContain("Acrobat Pro");
    expect(r.pdfDocumentId).toBeNull(); // no Drive in tests; the report still saves
    const facts = JSON.stringify((globalThis as { __facts?: unknown }).__facts);
    expect(facts).not.toMatch(/ssn|dob|ein/i);
  });

  it("refuses to put an internal file in a lender package", async () => {
    const doc = await prisma.document.create({
      data: {
        tenantId,
        dealId,
        type: "OTHER",
        internalOnly: true,
        driveFileId: `int-${Date.now()}`,
        fileName: "Risk Report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: "r",
      },
    });
    const funder = await prisma.funder.findFirstOrThrow({ where: { tenantId } });
    const user = await prisma.user.create({
      data: { tenantId, email: "t@ascendfund.co", name: "T" },
    });
    await expect(
      queueSubmissions(prisma, {
        tenantId,
        userId: user.id,
        dealId,
        funderIds: [funder.id],
        documentIds: [doc.id],
        positions: [],
        note: null,
      }),
    ).rejects.toThrow(/Internal files cannot be sent/);
  });
});
