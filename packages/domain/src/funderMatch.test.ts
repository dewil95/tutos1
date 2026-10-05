import { describe, expect, it } from "vitest";
import { matchFunders, type FunderProgramRule } from "./funderMatch";

const programs: FunderProgramRule[] = [
  {
    programId: "a-core",
    funderName: "Funder A",
    programName: "Core",
    paperGrades: ["A", "B"],
    minMonthlyRevenue: 15_000,
    minTimeInBusinessMonths: 12,
    minFico: 550,
    maxExistingPositions: 1,
    positionAppetite: ["1st", "2nd"],
    minAdvance: 10_000,
    maxAdvance: 250_000,
    allowedStates: ["ALL"],
    excludedStates: ["CA", "NY"],
    excludedNaics: ["7132"],
    isActive: true,
  },
  {
    programId: "b-second",
    funderName: "Funder B",
    programName: "Second Position",
    paperGrades: ["B", "C"],
    minMonthlyRevenue: 10_000,
    minTimeInBusinessMonths: 6,
    minFico: 500,
    maxExistingPositions: 2,
    positionAppetite: ["2nd", "3rd"],
    minAdvance: 5_000,
    maxAdvance: 100_000,
    allowedStates: [],
    excludedStates: [],
    excludedNaics: [],
    isActive: true,
  },
];

describe("matchFunders", () => {
  it("admits the first-position A-paper deal only to Funder A", () => {
    const res = matchFunders(
      {
        paperGrade: "A",
        avgMonthlyTrueRevenue: 40_000,
        timeInBusinessMonths: 24,
        ficoEstimate: 650,
        existingPositions: 0,
        requestedAmount: 50_000,
        state: "FL",
        naics: "722511",
      },
      programs,
    );
    expect(res.find((r) => r.programId === "a-core")?.eligible).toBe(true);
    const b = res.find((r) => r.programId === "b-second")!;
    expect(b.eligible).toBe(false);
    expect(b.failedRules).toContain("grade A not in B/C");
    expect(b.failedRules).toContain("does not fund 1st position");
  });

  it("routes a second-position C-paper deal to Funder B and explains Funder A's decline", () => {
    const res = matchFunders(
      {
        paperGrade: "C",
        avgMonthlyTrueRevenue: 18_000,
        timeInBusinessMonths: 9,
        ficoEstimate: 520,
        existingPositions: 1,
        requestedAmount: 20_000,
        state: "NY",
        naics: "238220",
      },
      programs,
    );
    expect(res.find((r) => r.programId === "b-second")?.eligible).toBe(true);
    const a = res.find((r) => r.programId === "a-core")!;
    expect(a.eligible).toBe(false);
    expect(a.failedRules).toEqual(
      expect.arrayContaining([
        "grade C not in A/B",
        "TIB below 12 months",
        "FICO below 550",
        "state NY excluded",
      ]),
    );
  });

  it("ignores inactive programs", () => {
    const res = matchFunders(
      {
        paperGrade: "B",
        avgMonthlyTrueRevenue: 20_000,
        timeInBusinessMonths: 20,
        ficoEstimate: 600,
        existingPositions: 1,
        requestedAmount: 20_000,
        state: "TX",
        naics: "238220",
      },
      programs.map((p) => ({ ...p, isActive: false })),
    );
    expect(res).toEqual([]);
  });
});
