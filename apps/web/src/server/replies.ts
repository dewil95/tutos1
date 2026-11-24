import type { FunderReply } from "@mca/ai";

export interface ParsedActivity<A extends { id: string; occurredAt: Date }> {
  a: A;
  r: FunderReply;
}

/** The activity ids a submission's status log points at (every reply the AI read for it). */
export function loggedActivityIds(rawStatusLog: unknown): string[] {
  return ((rawStatusLog ?? []) as { activityId?: string }[])
    .map((e) => e.activityId)
    .filter((x): x is string => !!x);
}

/** Replies for one submission, newest first. */
export function repliesFor<A extends { id: string; occurredAt: Date; aiSummary: unknown }>(
  rawStatusLog: unknown,
  activities: A[],
): ParsedActivity<A>[] {
  const ids = new Set(loggedActivityIds(rawStatusLog));
  return activities
    .filter((a) => a.aiSummary && ids.has(a.id))
    .sort((x, y) => y.occurredAt.getTime() - x.occurredAt.getTime())
    .map((a) => ({ a, r: a.aiSummary as FunderReply }));
}

/** The newest reply (what the lender said last). */
export function latestReply<A extends { id: string; occurredAt: Date; aiSummary: unknown }>(
  rawStatusLog: unknown,
  activities: A[],
): ParsedActivity<A> | undefined {
  return repliesFor(rawStatusLog, activities)[0];
}

/**
 * The newest reply that carries an offer. An acknowledgement or a stip request arriving after
 * the approval must not hide the terms.
 */
export function latestOffer<A extends { id: string; occurredAt: Date; aiSummary: unknown }>(
  rawStatusLog: unknown,
  activities: A[],
): ParsedActivity<A> | undefined {
  return repliesFor(rawStatusLog, activities).find((x) => x.r.offers.length > 0);
}
