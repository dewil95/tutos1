import { describe, expect, it } from "vitest";
import type { BankMetrics } from "./bankMetrics";
import { riskScore } from "./riskScore";

const metrics: BankMetrics = {
  monthsAnalysed: 4,
  avgMonthlyDeposits: 60_000,
  avgMonthlyTrueRevenue: 55_000,
  avgDepositCount: 80,
  avgDailyBalance: 6_000,
  adbToDepositsRatio: 0.1,
  totalNsf: 0,
  nsfPer90Days: 0,
  totalNegativeDays: 0,
  minDailyBalance: 1_000,
  revenueTrend: 0.02,
  depositVolatility: 0.1,
  incompleteMonths: [],
  annualisedTrueRevenue: 660_000,
};

describe("riskScore", () => {
  it("scores a clean first-position file as low risk", () => {
    const r = riskScore({
      metrics,
      scrub: { flags: [], holdbackBurdenPct: 0 },
      activePositions: 0,
      timeInBusinessMonths: 48,
      integrityIssues: 0,
    });
    expect(r).toEqual({ score: 100, level: "LOW", deductions: [] });
  });

  it("explains every point lost, biggest first", () => {
    const r = riskScore({
      metrics: {
        ...metrics,
        nsfPer90Days: 8,
        totalNegativeDays: 6,
        revenueTrend: -0.08,
        adbToDepositsRatio: 0.02,
      },
      scrub: {
        flags: [
          { code: "NEW_FUNDING", severity: "critical", message: "x" },
          { code: "NSF", severity: "warning", message: "y" },
        ],
        holdbackBurdenPct: 0.3,
      },
      activePositions: 3,
      timeInBusinessMonths: 8,
      integrityIssues: 1,
    });
    expect(r.deductions[0]).toEqual({ reason: "3 active position(s)", points: 18 });
    expect(r.score).toBe(100 - r.deductions.reduce((a, x) => a + x.points, 0));
    expect(r.level).toBe("VERY_HIGH");
    expect(r.deductions.map((x) => x.reason)).toContain("8 months in business");
  });
});
