import type { BankMetrics } from "./bankMetrics";

export type PaperGrade = "A" | "B" | "C" | "D";

/**
 * NAICS prefixes most funders exclude (docs/PLAN.md §1 stage 2). Tenants can extend.
 */
export const DEFAULT_RESTRICTED_NAICS_PREFIXES: Record<string, string> = {
  "7132": "Gambling industries",
  "713210": "Casinos",
  "7222": "Restaurants are allowed; placeholder removed", // kept out below
  "5222": "Nondepository credit intermediation (lenders)",
  "5223": "Activities related to credit intermediation",
  "52239": "Money services / check cashing",
  "56144": "Collection agencies",
  "56142": "Telemarketing bureaus",
  "711": "Adult entertainment (subset; verify)",
  "81": "Religious / nonprofit (subset; verify)",
  "4539": "Cannabis / CBD retail (subset; verify)",
  "3254": "Pharmaceutical incl. cannabis products (subset; verify)",
  "45111": "Firearms retail (subset; verify)",
};

// Restaurants are fundable; drop the placeholder so it is not treated as restricted.
delete DEFAULT_RESTRICTED_NAICS_PREFIXES["7222"];

export interface QualificationInput {
  timeInBusinessMonths: number | null;
  monthlyRevenue: number | null;
  ficoEstimate: number | null;
  existingPositions: number;
  naics: string | null;
  state: string | null;
  restrictedNaicsPrefixes?: Record<string, string>;
  excludedStates?: string[];
}

export interface QualificationRule {
  code: string;
  passed: boolean;
  detail: string;
  /** hard = decline outright; soft = flag for human */
  severity: "hard" | "soft";
}

export interface QualificationResult {
  qualified: boolean;
  rules: QualificationRule[];
}

/** Hard-rule pre-qualification applied at intake, before any AI call. */
export function qualifyLead(input: QualificationInput): QualificationResult {
  const rules: QualificationRule[] = [];
  const restricted = input.restrictedNaicsPrefixes ?? DEFAULT_RESTRICTED_NAICS_PREFIXES;

  rules.push({
    code: "TIME_IN_BUSINESS",
    passed: input.timeInBusinessMonths === null || input.timeInBusinessMonths >= 6,
    detail:
      input.timeInBusinessMonths === null
        ? "Time in business unknown"
        : `${input.timeInBusinessMonths} months in business (floor 6)`,
    severity: input.timeInBusinessMonths === null ? "soft" : "hard",
  });

  rules.push({
    code: "MONTHLY_REVENUE",
    passed: input.monthlyRevenue === null || input.monthlyRevenue >= 10_000,
    detail:
      input.monthlyRevenue === null
        ? "Monthly revenue unknown"
        : `$${input.monthlyRevenue.toLocaleString()} monthly revenue (floor $10,000)`,
    severity: input.monthlyRevenue === null ? "soft" : "hard",
  });

  rules.push({
    code: "FICO",
    passed: input.ficoEstimate === null || input.ficoEstimate >= 500,
    detail:
      input.ficoEstimate === null
        ? "FICO unknown (soft pull later)"
        : `FICO ${input.ficoEstimate} (floor 500)`,
    severity: "soft",
  });

  rules.push({
    code: "EXISTING_POSITIONS",
    passed: input.existingPositions <= 2,
    detail: `${input.existingPositions} existing position(s) (most funders cap at 2)`,
    severity: input.existingPositions > 3 ? "hard" : "soft",
  });

  const naicsHit =
    input.naics === null
      ? undefined
      : Object.entries(restricted).find(([prefix]) => input.naics!.startsWith(prefix));
  rules.push({
    code: "INDUSTRY",
    passed: !naicsHit,
    detail: naicsHit
      ? `NAICS ${input.naics} matches restricted "${naicsHit[1]}"`
      : input.naics
        ? `NAICS ${input.naics} not restricted`
        : "Industry unknown",
    severity: "hard",
  });

  if (input.excludedStates?.length) {
    const hit = input.state !== null && input.excludedStates.includes(input.state.toUpperCase());
    rules.push({
      code: "STATE",
      passed: !hit,
      detail: hit ? `${input.state} is excluded for this tenant` : "State allowed",
      severity: "hard",
    });
  }

  const qualified = rules.every((r) => r.passed || r.severity === "soft");
  return { qualified, rules };
}

export interface GradeInput {
  metrics: BankMetrics;
  ficoEstimate: number | null;
  timeInBusinessMonths: number | null;
  existingPositions: number;
}

export interface GradeResult {
  grade: PaperGrade;
  reasons: string[];
  redFlags: string[];
}

/**
 * Deterministic paper grade from statement metrics (docs/PLAN.md §1 stage 4). Claude job A3
 * receives this result and explains / challenges it; it does not replace it.
 */
export function gradePaper(input: GradeInput): GradeResult {
  const m = input.metrics;
  const reasons: string[] = [];
  const redFlags: string[] = [];
  let score = 0; // higher = better

  // Revenue
  if (m.avgMonthlyTrueRevenue >= 30_000) {
    score += 3;
    reasons.push("True revenue ≥ $30K/mo");
  } else if (m.avgMonthlyTrueRevenue >= 15_000) {
    score += 2;
    reasons.push("True revenue $15–30K/mo");
  } else if (m.avgMonthlyTrueRevenue >= 5_000) {
    score += 1;
    reasons.push("True revenue $5–15K/mo");
  } else {
    redFlags.push("True revenue below $5K/mo");
  }

  // NSFs per 90 days
  if (m.nsfPer90Days < 2) {
    score += 3;
    reasons.push("< 2 NSFs per 90 days");
  } else if (m.nsfPer90Days <= 5) {
    score += 2;
    reasons.push("2–5 NSFs per 90 days");
  } else if (m.nsfPer90Days <= 10) {
    score += 1;
    reasons.push("5–10 NSFs per 90 days");
  } else {
    redFlags.push(`${m.nsfPer90Days} NSFs per 90 days`);
  }

  // Balance health
  if (m.adbToDepositsRatio >= 0.05 && m.totalNegativeDays === 0) {
    score += 2;
    reasons.push("ADB ≥ 5% of deposits, no negative days");
  } else if (m.adbToDepositsRatio >= 0.03) {
    score += 1;
    reasons.push("ADB 3–5% of deposits");
  } else {
    redFlags.push("Average daily balance below 3% of deposits");
  }
  if (m.totalNegativeDays > 5) redFlags.push(`${m.totalNegativeDays} negative balance days`);

  // Time in business
  if (input.timeInBusinessMonths !== null) {
    if (input.timeInBusinessMonths >= 12) score += 2;
    else if (input.timeInBusinessMonths >= 6) score += 1;
    else redFlags.push("Under 6 months in business");
  }

  // FICO
  if (input.ficoEstimate !== null) {
    if (input.ficoEstimate >= 650) score += 2;
    else if (input.ficoEstimate >= 550) score += 1;
    else redFlags.push(`FICO ${input.ficoEstimate}`);
  }

  // Positions & trend
  if (input.existingPositions >= 3) redFlags.push(`${input.existingPositions} existing positions`);
  else if (input.existingPositions === 0) score += 1;
  if (m.revenueTrend <= -0.1) redFlags.push("Revenue declining > 10% per month");
  if (m.depositVolatility > 0.5) redFlags.push("Highly volatile deposits");
  if (m.incompleteMonths.length)
    redFlags.push(`Incomplete months: ${m.incompleteMonths.join(", ")}`);

  const maxScore = 13;
  const pct = score / maxScore;
  let grade: PaperGrade;
  if (pct >= 0.8 && redFlags.length === 0) grade = "A";
  else if (pct >= 0.6 && redFlags.length <= 1) grade = "B";
  else if (pct >= 0.35) grade = "C";
  else grade = "D";

  return { grade, reasons, redFlags };
}
