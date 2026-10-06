import { buildRecipients } from "@mca/connectors";
import type { Funder, FunderProgram, PrismaClient, Tenant } from "@mca/db";
import {
  rankFunders,
  type DealProfile,
  type FunderProgramRule,
  type LenderHistory,
  type PaperGrade,
} from "@mca/domain";

export type FunderWithPrograms = Funder & { programs: FunderProgram[] };

export function programRules(funders: FunderWithPrograms[]): FunderProgramRule[] {
  // Keyed by funder id: a lender with several programs is ranked by its best-fitting one.
  return funders.flatMap((f) =>
    (f.programs.length ? f.programs : [null]).map((p) => ({
      programId: f.id,
      funderName: f.name,
      programName: p?.name ?? "Core",
      paperGrades: p?.paperGrades ?? [],
      minMonthlyRevenue: p?.minMonthlyRevenue ? Number(p.minMonthlyRevenue) : null,
      minTimeInBusinessMonths: p?.minTimeInBusinessMonths ?? null,
      minFico: p?.minFico ?? null,
      maxExistingPositions: p?.maxExistingPositions ?? null,
      positionAppetite: p?.positionAppetite ?? [],
      minAdvance: p?.minAdvance ? Number(p.minAdvance) : null,
      maxAdvance: p?.maxAdvance ? Number(p.maxAdvance) : null,
      allowedStates: p?.allowedStates ?? [],
      excludedStates: p?.excludedStates ?? [],
      excludedNaics: p?.excludedNaics ?? [],
      isActive: p?.isActive ?? true,
    })),
  );
}

/** Approval history per lender across all of the tenant's submissions. */
export async function lenderHistory(
  prisma: PrismaClient,
  tenantId: string,
  grade: string | null,
): Promise<Record<string, LenderHistory>> {
  const rows = await prisma.submission.findMany({
    where: { deal: { tenantId }, status: { notIn: ["DRAFT", "WITHDRAWN"] } },
    select: { funderId: true, status: true, deal: { select: { paperGrade: true } } },
  });
  const out: Record<string, LenderHistory> = {};
  for (const r of rows) {
    const h = (out[r.funderId] ??= {
      submitted: 0,
      approved: 0,
      declined: 0,
      submittedSameGrade: 0,
      approvedSameGrade: 0,
    });
    h.submitted++;
    if (r.status === "APPROVED") h.approved++;
    if (r.status === "DECLINED") h.declined++;
    if (grade && r.deal.paperGrade === grade) {
      h.submittedSameGrade!++;
      if (r.status === "APPROVED") h.approvedSameGrade!++;
    }
  }
  return out;
}

export interface LenderRow {
  funder: FunderWithPrograms;
  to: string[];
  cc: string[];
  problem: string | null;
  already: boolean;
  eligible: boolean;
  score: number;
  reasons: string[];
}

/** Lenders for one deal in recommended order, each with its exact To/CC. */
export function lenderRows(opts: {
  funders: FunderWithPrograms[];
  tenant: Pick<Tenant, "teamCc" | "fromAddress">;
  profile: DealProfile;
  history: Record<string, LenderHistory>;
  alreadySubmitted: Set<string>;
}): LenderRow[] {
  const ranked = rankFunders(opts.profile, programRules(opts.funders), opts.history);
  const best = new Map<string, (typeof ranked)[number]>();
  for (const r of ranked) if (!best.has(r.programId)) best.set(r.programId, r); // first = best
  const rows = opts.funders.map((f): LenderRow => {
    let to: string[] = [];
    let cc: string[] = [];
    let problem: string | null = null;
    try {
      ({ to, cc } = buildRecipients(
        { emails: [f.submissionTo, ...f.submissionCc].filter((e): e is string => !!e) },
        { teamCc: opts.tenant.teamCc, from: opts.tenant.fromAddress ?? undefined },
      ));
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
    const r = best.get(f.id);
    return {
      funder: f,
      to,
      cc,
      problem,
      already: opts.alreadySubmitted.has(f.id),
      eligible: r?.eligible ?? true,
      score: r?.score ?? 0,
      reasons: r?.reasons ?? [],
    };
  });
  const sendable = (r: LenderRow) => !r.already && !r.problem;
  return rows.sort(
    (a, b) =>
      Number(sendable(b)) - Number(sendable(a)) ||
      Number(b.eligible) - Number(a.eligible) ||
      b.score - a.score ||
      a.funder.name.localeCompare(b.funder.name),
  );
}

export function dealProfile(input: {
  paperGrade: string | null;
  avgMonthlyTrueRevenue: number | null;
  startDate: Date | null;
  existingPositions: number;
  requestedAmount: number | null;
  state: string | null;
  naics: string | null;
}): DealProfile {
  const grade =
    input.paperGrade && /^[ABCD]$/.test(input.paperGrade) ? (input.paperGrade as PaperGrade) : null;
  return {
    paperGrade: grade,
    avgMonthlyTrueRevenue: input.avgMonthlyTrueRevenue,
    timeInBusinessMonths: input.startDate
      ? Math.floor((Date.now() - input.startDate.getTime()) / (30.44 * 86_400_000))
      : null,
    ficoEstimate: null,
    existingPositions: input.existingPositions,
    requestedAmount: input.requestedAmount,
    state: input.state,
    naics: input.naics,
  };
}
