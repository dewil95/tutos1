import type { PaperGrade } from "./qualification";

/** Structural mirror of the FunderProgram row (docs/funder-appetite-matrix.csv). */
export interface FunderProgramRule {
  programId: string;
  funderName: string;
  programName: string;
  paperGrades: string[];
  minMonthlyRevenue: number | null;
  minTimeInBusinessMonths: number | null;
  minFico: number | null;
  maxExistingPositions: number | null;
  positionAppetite: string[]; // "1st" | "2nd" | ...
  minAdvance: number | null;
  maxAdvance: number | null;
  allowedStates: string[]; // empty = all
  excludedStates: string[];
  excludedNaics: string[];
  isActive: boolean;
}

export interface DealProfile {
  /** null until statements are analysed; grade rules are then skipped. */
  paperGrade: PaperGrade | null;
  /** null until statements are analysed (or typed in); revenue rules are then skipped. */
  avgMonthlyTrueRevenue: number | null;
  timeInBusinessMonths: number | null;
  ficoEstimate: number | null;
  existingPositions: number;
  requestedAmount: number | null;
  state: string | null;
  naics: string | null;
}

export interface FunderMatch {
  programId: string;
  funderName: string;
  programName: string;
  eligible: boolean;
  failedRules: string[];
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];

/**
 * Hard appetite filter. rankFunders() orders only the programs this returns as eligible and
 * explains why; it never re-admits a program that failed a hard rule.
 */
export function matchFunders(deal: DealProfile, programs: FunderProgramRule[]): FunderMatch[] {
  const nextPosition = ORDINALS[Math.min(deal.existingPositions, ORDINALS.length - 1)]!;
  return programs
    .filter((p) => p.isActive)
    .map((p) => {
      const failed: string[] = [];
      if (deal.paperGrade && p.paperGrades.length && !p.paperGrades.includes(deal.paperGrade))
        failed.push(`grade ${deal.paperGrade} not in ${p.paperGrades.join("/")}`);
      if (
        p.minMonthlyRevenue !== null &&
        deal.avgMonthlyTrueRevenue !== null &&
        deal.avgMonthlyTrueRevenue < p.minMonthlyRevenue
      )
        failed.push(`revenue below $${p.minMonthlyRevenue.toLocaleString()}`);
      if (
        p.minTimeInBusinessMonths !== null &&
        deal.timeInBusinessMonths !== null &&
        deal.timeInBusinessMonths < p.minTimeInBusinessMonths
      )
        failed.push(`TIB below ${p.minTimeInBusinessMonths} months`);
      if (p.minFico !== null && deal.ficoEstimate !== null && deal.ficoEstimate < p.minFico)
        failed.push(`FICO below ${p.minFico}`);
      if (p.maxExistingPositions !== null && deal.existingPositions > p.maxExistingPositions)
        failed.push(`more than ${p.maxExistingPositions} existing positions`);
      if (p.positionAppetite.length && !p.positionAppetite.includes(nextPosition))
        failed.push(`does not fund ${nextPosition} position`);
      if (deal.requestedAmount !== null) {
        if (p.minAdvance !== null && deal.requestedAmount < p.minAdvance)
          failed.push(`requested below min advance $${p.minAdvance.toLocaleString()}`);
        if (p.maxAdvance !== null && deal.requestedAmount > p.maxAdvance)
          failed.push(`requested above max advance $${p.maxAdvance.toLocaleString()}`);
      }
      if (deal.state) {
        const st = deal.state.toUpperCase();
        if (
          p.allowedStates.length &&
          !p.allowedStates.includes("ALL") &&
          !p.allowedStates.includes(st)
        )
          failed.push(`state ${st} not allowed`);
        if (p.excludedStates.includes(st)) failed.push(`state ${st} excluded`);
      }
      if (deal.naics && p.excludedNaics.some((prefix) => deal.naics!.startsWith(prefix)))
        failed.push(`industry ${deal.naics} excluded`);

      return {
        programId: p.programId,
        funderName: p.funderName,
        programName: p.programName,
        eligible: failed.length === 0,
        failedRules: failed,
      };
    });
}

/** What happened the last times this lender saw Ascend's files. */
export interface LenderHistory {
  submitted: number;
  approved: number;
  declined: number;
  /** Approvals on deals of the same paper grade (when known). */
  approvedSameGrade?: number;
  submittedSameGrade?: number;
}

export interface RankedFunder extends FunderMatch {
  /** 0–100; eligible lenders always rank above ineligible ones. */
  score: number;
  /** Plain-language reasons shown next to the lender. */
  reasons: string[];
}

/**
 * Orders lenders for a deal: hard appetite rules first (matchFunders), then how comfortably the
 * deal clears each lender's minimums and how often that lender has approved Ascend's files.
 * Deterministic and explainable; the rep still picks.
 */
export function rankFunders(
  deal: DealProfile,
  programs: FunderProgramRule[],
  history: Record<string, LenderHistory> = {},
): RankedFunder[] {
  const byId = new Map(programs.map((p) => [p.programId, p]));
  const nextPositionIndex = Math.min(deal.existingPositions, ORDINALS.length - 1);
  const ranked = matchFunders(deal, programs).map((m): RankedFunder => {
    const p = byId.get(m.programId)!;
    const reasons: string[] = [];
    let score = 50;

    if (p.minMonthlyRevenue && deal.avgMonthlyTrueRevenue !== null) {
      const headroom = deal.avgMonthlyTrueRevenue / p.minMonthlyRevenue - 1;
      if (headroom >= 0) {
        score += Math.min(15, headroom * 15);
        if (headroom >= 0.5) reasons.push("revenue well above minimum");
      }
    }
    if (p.maxExistingPositions !== null) {
      const spare = p.maxExistingPositions - deal.existingPositions;
      if (spare >= 0) score += Math.min(10, spare * 5);
      if (spare === 0) reasons.push("at max positions");
    }
    if (p.positionAppetite.includes(ORDINALS[nextPositionIndex]!)) {
      score += 5;
    }
    if (deal.paperGrade && p.paperGrades.includes(deal.paperGrade)) score += 5;
    if (
      deal.requestedAmount !== null &&
      p.maxAdvance !== null &&
      deal.requestedAmount <= p.maxAdvance
    ) {
      score += 3;
    }

    const h = history[m.programId];
    if (h && h.submitted > 0) {
      // Smoothed approval rate so one result does not swing the ranking.
      const sameGrade = h.submittedSameGrade
        ? (h.approvedSameGrade ?? 0) / h.submittedSameGrade
        : null;
      const rate = (h.approved + 1) / (h.submitted + 2);
      score += (rate - 0.5) * 30 + (sameGrade !== null ? (sameGrade - 0.5) * 10 : 0);
      reasons.push(`approved ${h.approved} of ${h.submitted} sent`);
    }

    if (!m.eligible) {
      score = Math.max(0, 20 - 10 * m.failedRules.length);
      reasons.unshift(...m.failedRules);
    }
    return { ...m, score: Math.round(Math.max(0, Math.min(100, score))), reasons };
  });
  return ranked.sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      b.score - a.score ||
      a.funderName.localeCompare(b.funderName),
  );
}
