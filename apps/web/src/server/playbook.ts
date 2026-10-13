import type { FunderReply } from "@mca/ai";
import type { PrismaClient } from "@mca/db";

/**
 * The lender playbook: what each lender did with Ascend's files (from the CRM's own sends, the
 * funding inbox and any history mailbox), and how the team shops deals.
 */

export interface PlaybookSubmission {
  funderId: string;
  funderName: string;
  dealId: string;
  status: string;
  declineReason: string | null;
  sentAt: Date | null;
  log: { at?: string; intent?: string; activityId?: string }[];
  paperGrade: string | null;
  state: string | null;
  positions: number;
}

export interface LenderPlaybook {
  funderId: string;
  name: string;
  sent: number;
  approved: number;
  declined: number;
  pending: number;
  funded: number;
  /** approved / (approved + declined), null until a lender has answered. */
  approvalRate: number | null;
  declineReasons: { reason: string; count: number }[];
  typicalOffer: {
    offers: number;
    amount: number | null;
    factor: number | null;
    termDays: number | null;
    points: number | null;
  };
  medianReplyHours: number | null;
  approvedGrades: string[];
  approvedStates: string[];
  maxPositionsApproved: number | null;
  lastSentAt: Date | null;
}

export interface ShoppingHabits {
  dealsShopped: number;
  avgLendersPerDeal: number | null;
  medianLendersPerDeal: number | null;
  mostSent: { name: string; count: number }[];
  sentTogether: { a: string; b: string; count: number }[];
  dealsWithPositions: number;
  medianPositions: number | null;
  byPositions: { positions: string; sent: number; approved: number; declined: number }[];
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

const ANSWERED = new Set(["APPROVED", "DECLINED"]);
const PENDING = new Set(["SENT", "ACKNOWLEDGED", "IN_REVIEW", "STIPS_REQUESTED"]);
const OFFER_INTENTS = new Set(["APPROVED", "OFFER_REVISED"]);

const reasonKey = (r: string) =>
  r
    .toLowerCase()
    .replace(/[.!\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

function top<T extends string>(items: T[], n: number): { value: T; count: number }[] {
  const counts = new Map<T, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, n);
}

/** Per-lender results; `replies` are the A8 readings of lender emails, by activity id. */
export function lenderPlaybook(
  subs: PlaybookSubmission[],
  replies: Map<string, FunderReply>,
): LenderPlaybook[] {
  const byFunder = new Map<string, PlaybookSubmission[]>();
  for (const s of subs) byFunder.set(s.funderId, [...(byFunder.get(s.funderId) ?? []), s]);
  const out: LenderPlaybook[] = [];
  for (const [funderId, rows] of byFunder) {
    const approved = rows.filter((r) => r.status === "APPROVED");
    const declined = rows.filter((r) => r.status === "DECLINED");
    const answered = rows.filter((r) => ANSWERED.has(r.status)).length;

    const firstCasing = new Map<string, string>();
    const reasons: string[] = [];
    for (const r of declined) {
      // One decline can carry several reasons ("low revenue; too many positions").
      for (const part of (r.declineReason ?? "").split(/;\s*/)) {
        const k = reasonKey(part);
        if (!k || k === "no reason given") continue;
        if (!firstCasing.has(k)) firstCasing.set(k, part.trim().replace(/[.!\s]+$/g, ""));
        reasons.push(k);
      }
    }

    const offers = rows
      .flatMap((r) => r.log)
      .filter((e) => e.activityId && e.intent && OFFER_INTENTS.has(e.intent))
      .flatMap((e) => replies.get(e.activityId!)?.offers ?? []);

    const replyHours = rows.flatMap((r) => {
      const first = r.log.find((e) => e.intent && e.at);
      if (!first || !r.sentAt) return [];
      const h = (Date.parse(first.at!) - r.sentAt.getTime()) / 3_600_000;
      return h >= 0 ? [h] : [];
    });

    out.push({
      funderId,
      name: rows[0]!.funderName,
      sent: rows.length,
      approved: approved.length,
      declined: declined.length,
      pending: rows.filter((r) => PENDING.has(r.status)).length,
      funded: rows.filter((r) => r.log.some((e) => e.intent === "FUNDED")).length,
      approvalRate: answered ? approved.length / answered : null,
      declineReasons: top(reasons, 3).map((x) => ({
        reason: firstCasing.get(x.value)!,
        count: x.count,
      })),
      typicalOffer: {
        offers: offers.length,
        amount: median(offers.flatMap((o) => (o.advanceAmount ? [o.advanceAmount] : []))),
        factor: median(offers.flatMap((o) => (o.factorRate ? [o.factorRate] : []))),
        termDays: median(offers.flatMap((o) => (o.termDays ? [o.termDays] : []))),
        points: median(
          offers.flatMap((o) =>
            (o.commissionPoints ?? null) !== null ? [o.commissionPoints!] : [],
          ),
        ),
      },
      medianReplyHours: median(replyHours),
      approvedGrades: [
        ...new Set(approved.flatMap((r) => (r.paperGrade ? [r.paperGrade] : []))),
      ].sort(),
      approvedStates: [...new Set(approved.flatMap((r) => (r.state ? [r.state] : [])))].sort(),
      maxPositionsApproved: approved.length ? Math.max(...approved.map((r) => r.positions)) : null,
      lastSentAt: rows.reduce<Date | null>(
        (m, r) => (r.sentAt && (!m || r.sentAt > m) ? r.sentAt : m),
        null,
      ),
    });
  }
  return out.sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));
}

/** How the team shops: lenders per deal, who gets sent together, positions on the files. */
export function shoppingHabits(subs: PlaybookSubmission[]): ShoppingHabits {
  const byDeal = new Map<string, PlaybookSubmission[]>();
  for (const s of subs) byDeal.set(s.dealId, [...(byDeal.get(s.dealId) ?? []), s]);
  const perDeal = [...byDeal.values()].map((rows) => [...new Set(rows.map((r) => r.funderName))]);
  const pairs: string[] = [];
  for (const names of perDeal) {
    const sorted = [...names].sort();
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++) pairs.push(`${sorted[i]}\u0000${sorted[j]}`);
  }
  const positionsPerDeal = [...byDeal.values()].map((rows) => rows[0]!.positions);
  const bucket = (n: number) => (n >= 3 ? "3+" : String(n));
  const byPositions = ["0", "1", "2", "3+"].map((p) => {
    const rows = subs.filter((s) => bucket(s.positions) === p);
    return {
      positions: p,
      sent: rows.length,
      approved: rows.filter((r) => r.status === "APPROVED").length,
      declined: rows.filter((r) => r.status === "DECLINED").length,
    };
  });
  return {
    dealsShopped: byDeal.size,
    avgLendersPerDeal: perDeal.length
      ? perDeal.reduce((n, d) => n + d.length, 0) / perDeal.length
      : null,
    medianLendersPerDeal: median(perDeal.map((d) => d.length)),
    mostSent: top(
      subs.map((s) => s.funderName),
      5,
    ).map((x) => ({ name: x.value, count: x.count })),
    sentTogether: top(pairs, 5).map((x) => {
      const [a, b] = x.value.split("\u0000");
      return { a: a!, b: b!, count: x.count };
    }),
    dealsWithPositions: positionsPerDeal.filter((n) => n > 0).length,
    medianPositions: median(positionsPerDeal),
    byPositions,
  };
}

/** Loads every sent submission of the tenant with what the playbook needs. */
export async function loadPlaybook(prisma: PrismaClient, tenantId: string) {
  const rows = await prisma.submission.findMany({
    where: { deal: { tenantId }, status: { notIn: ["DRAFT", "WITHDRAWN"] } },
    select: {
      funderId: true,
      dealId: true,
      status: true,
      declineReason: true,
      sentAt: true,
      rawStatusLog: true,
      funder: { select: { name: true } },
      deal: {
        select: {
          paperGrade: true,
          submissionPositions: true,
          merchant: { select: { state: true } },
        },
      },
    },
  });
  const subs: PlaybookSubmission[] = rows.map((r) => ({
    funderId: r.funderId,
    funderName: r.funder.name,
    dealId: r.dealId,
    status: r.status,
    declineReason: r.declineReason,
    sentAt: r.sentAt,
    log: Array.isArray(r.rawStatusLog) ? (r.rawStatusLog as PlaybookSubmission["log"]) : [],
    paperGrade: r.deal.paperGrade,
    state: r.deal.merchant.state,
    positions: Array.isArray(r.deal.submissionPositions) ? r.deal.submissionPositions.length : 0,
  }));
  const activityIds = [
    ...new Set(subs.flatMap((s) => s.log.flatMap((e) => (e.activityId ? [e.activityId] : [])))),
  ];
  const activities = activityIds.length
    ? await prisma.activity.findMany({
        where: { id: { in: activityIds }, tenantId },
        select: { id: true, aiSummary: true },
      })
    : [];
  const replies = new Map(
    activities.flatMap((a) =>
      a.aiSummary ? [[a.id, a.aiSummary as unknown as FunderReply] as const] : [],
    ),
  );
  return { lenders: lenderPlaybook(subs, replies), habits: shoppingHabits(subs) };
}
