import { describe, expect, it } from "vitest";
import { computeBankMetrics, type MonthlyRow } from "./bankMetrics";
import { gradePaper, qualifyLead } from "./qualification";

function row(partial: Partial<MonthlyRow> & { month: string }): MonthlyRow {
  return {
    beginningBalance: 10_000,
    endingBalance: 12_000,
    totalDeposits: 50_000,
    depositCount: 40,
    totalWithdrawals: 48_000,
    nonRevenueDeposits: 0,
    averageDailyBalance: 6_000,
    nsfCount: 0,
    overdraftFeeCount: 0,
    negativeDays: 0,
    minDailyBalance: 1_500,
    isComplete: true,
    ...partial,
  };
}

const cleanFourMonths: MonthlyRow[] = [
  row({ month: "2026-05", totalDeposits: 48_000 }),
  row({ month: "2026-06", totalDeposits: 50_000 }),
  row({ month: "2026-07", totalDeposits: 52_000 }),
  row({ month: "2026-08", totalDeposits: 54_000 }),
];

describe("computeBankMetrics", () => {
  it("aggregates a clean four-month set", () => {
    const m = computeBankMetrics(cleanFourMonths);
    expect(m.monthsAnalysed).toBe(4);
    expect(m.avgMonthlyDeposits).toBe(51_000);
    expect(m.avgMonthlyTrueRevenue).toBe(51_000);
    expect(m.annualisedTrueRevenue).toBe(612_000);
    expect(m.adbToDepositsRatio).toBeCloseTo(0.1176, 3);
    expect(m.totalNsf).toBe(0);
    expect(m.nsfPer90Days).toBe(0);
    expect(m.revenueTrend).toBeGreaterThan(0);
    expect(m.incompleteMonths).toEqual([]);
  });

  it("excludes non-revenue deposits and flags incomplete months", () => {
    const m = computeBankMetrics([
      row({ month: "2026-07", totalDeposits: 80_000, nonRevenueDeposits: 30_000 }),
      row({ month: "2026-08", totalDeposits: 50_000, isComplete: false, nsfCount: 4 }),
    ]);
    expect(m.avgMonthlyTrueRevenue).toBe(50_000);
    expect(m.avgMonthlyDeposits).toBe(65_000);
    expect(m.incompleteMonths).toEqual(["2026-08"]);
    expect(m.nsfPer90Days).toBe(6);
  });

  it("sorts rows by month before computing trend", () => {
    const m = computeBankMetrics([...cleanFourMonths].reverse());
    expect(m.revenueTrend).toBeGreaterThan(0);
  });
});

describe("gradePaper", () => {
  it("grades a clean, established, high-revenue file as A", () => {
    const g = gradePaper({
      metrics: computeBankMetrics(cleanFourMonths),
      ficoEstimate: 680,
      timeInBusinessMonths: 36,
      existingPositions: 0,
    });
    expect(g.grade).toBe("A");
    expect(g.redFlags).toEqual([]);
  });

  it("grades a stacked, NSF-heavy file as D", () => {
    const g = gradePaper({
      metrics: computeBankMetrics([
        row({
          month: "2026-06",
          totalDeposits: 9_000,
          nsfCount: 6,
          negativeDays: 4,
          averageDailyBalance: 150,
        }),
        row({
          month: "2026-07",
          totalDeposits: 8_000,
          nsfCount: 7,
          negativeDays: 6,
          averageDailyBalance: 100,
        }),
        row({
          month: "2026-08",
          totalDeposits: 6_000,
          nsfCount: 5,
          negativeDays: 5,
          averageDailyBalance: 80,
        }),
      ]),
      ficoEstimate: 510,
      timeInBusinessMonths: 5,
      existingPositions: 3,
    });
    expect(g.grade).toBe("D");
    expect(g.redFlags.length).toBeGreaterThanOrEqual(4);
  });
});

describe("qualifyLead", () => {
  it("passes a standard qualified lead", () => {
    const q = qualifyLead({
      timeInBusinessMonths: 24,
      monthlyRevenue: 40_000,
      ficoEstimate: 600,
      existingPositions: 1,
      naics: "722511",
      state: "FL",
    });
    expect(q.qualified).toBe(true);
    expect(q.rules.every((r) => r.passed)).toBe(true);
  });

  it("hard-fails restricted industries and too-new businesses", () => {
    const q = qualifyLead({
      timeInBusinessMonths: 3,
      monthlyRevenue: 40_000,
      ficoEstimate: null,
      existingPositions: 0,
      naics: "522291",
      state: "NY",
    });
    expect(q.qualified).toBe(false);
    const failed = q.rules.filter((r) => !r.passed).map((r) => r.code);
    expect(failed).toContain("INDUSTRY");
    expect(failed).toContain("TIME_IN_BUSINESS");
  });

  it("treats unknown values as soft rules", () => {
    const q = qualifyLead({
      timeInBusinessMonths: null,
      monthlyRevenue: null,
      ficoEstimate: null,
      existingPositions: 0,
      naics: null,
      state: null,
    });
    expect(q.qualified).toBe(true);
  });

  it("applies tenant state exclusions", () => {
    const q = qualifyLead({
      timeInBusinessMonths: 12,
      monthlyRevenue: 20_000,
      ficoEstimate: 600,
      existingPositions: 0,
      naics: "238220",
      state: "ca",
      excludedStates: ["CA"],
    });
    expect(q.qualified).toBe(false);
  });
});
