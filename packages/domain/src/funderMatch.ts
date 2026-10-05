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
  paperGrade: PaperGrade;
  avgMonthlyTrueRevenue: number;
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
 * Hard appetite filter. Claude job A6 ranks only the programs this returns as eligible and
 * explains why; it never re-admits a program that failed a hard rule.
 */
export function matchFunders(deal: DealProfile, programs: FunderProgramRule[]): FunderMatch[] {
  const nextPosition = ORDINALS[Math.min(deal.existingPositions, ORDINALS.length - 1)]!;
  return programs
    .filter((p) => p.isActive)
    .map((p) => {
      const failed: string[] = [];
      if (p.paperGrades.length && !p.paperGrades.includes(deal.paperGrade))
        failed.push(`grade ${deal.paperGrade} not in ${p.paperGrades.join("/")}`);
      if (p.minMonthlyRevenue !== null && deal.avgMonthlyTrueRevenue < p.minMonthlyRevenue)
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
