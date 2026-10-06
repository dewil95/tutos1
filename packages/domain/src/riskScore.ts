import type { BankMetrics } from "./bankMetrics";
import type { ScrubReport } from "./scrub";

/**
 * 0–100 risk score for the internal Risk Report (100 = cleanest file). Pure arithmetic over the
 * scrub and metrics so the number never comes from a language model; every point lost is listed.
 */
export interface RiskScoreInput {
  metrics: BankMetrics;
  scrub: Pick<ScrubReport, "flags" | "holdbackBurdenPct">;
  activePositions: number;
  timeInBusinessMonths: number | null;
  /** Integrity hints from the files (PDF history / visual check) that are not resolved. */
  integrityIssues: number;
}

export interface RiskScore {
  score: number;
  level: "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH";
  deductions: { reason: string; points: number }[];
}

export function riskScore(input: RiskScoreInput): RiskScore {
  const d: RiskScore["deductions"] = [];
  const take = (points: number, reason: string) => {
    if (points > 0) d.push({ reason, points: Math.round(points) });
  };
  const m = input.metrics;

  const critical = input.scrub.flags.filter((f) => f.severity === "critical").length;
  const warnings = input.scrub.flags.filter((f) => f.severity === "warning").length;
  take(Math.min(36, critical * 12), `${critical} critical scrub flag(s)`);
  take(Math.min(16, warnings * 4), `${warnings} scrub warning(s)`);
  take(
    Math.min(20, input.integrityIssues * 10),
    `${input.integrityIssues} document integrity hint(s)`,
  );

  if (m.nsfPer90Days > 2)
    take(Math.min(12, (m.nsfPer90Days - 2) * 2), `${m.nsfPer90Days} NSFs per 90 days`);
  if (m.totalNegativeDays > 0)
    take(Math.min(10, m.totalNegativeDays), `${m.totalNegativeDays} negative days`);
  if (m.adbToDepositsRatio < 0.05) take(8, "average balance under 5% of deposits");
  if (m.revenueTrend < 0) take(Math.min(10, -m.revenueTrend * 100), "revenue trending down");
  if (m.avgMonthlyTrueRevenue < 15_000) take(8, "true revenue under $15K/month");

  take(Math.min(18, input.activePositions * 6), `${input.activePositions} active position(s)`);
  take(Math.min(15, input.scrub.holdbackBurdenPct * 40), "existing payments vs revenue");

  if (input.timeInBusinessMonths !== null && input.timeInBusinessMonths < 12) {
    take(
      input.timeInBusinessMonths < 6 ? 10 : 5,
      `${input.timeInBusinessMonths} months in business`,
    );
  }

  const score = Math.max(0, 100 - d.reduce((a, x) => a + x.points, 0));
  const level = score >= 75 ? "LOW" : score >= 55 ? "MODERATE" : score >= 35 ? "HIGH" : "VERY_HIGH";
  return { score, level, deductions: d.sort((a, b) => b.points - a.points) };
}
