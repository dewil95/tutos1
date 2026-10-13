import type { Prisma, PrismaClient } from "./generated/client";

export type JobType =
  | "SEND_SUBMISSION"
  | "INBOX_SYNC"
  | "PARSE_REPLY"
  | "STATEMENT_ANALYSIS"
  | "APPLICATION_READ"
  | "STATEMENT_EXTRACT"
  | "STATEMENT_SCRUB"
  | "RISK_REPORT"
  | "EMAIL_RULES"
  | "WHATSAPP_MESSAGE"
  | "WHATSAPP_APP_READ"
  | "WHATSAPP_NUDGES";

export interface ClaimedJob {
  id: string;
  tenantId: string;
  type: JobType;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
}

export interface EnqueueInput {
  tenantId: string;
  type: JobType;
  payload: Prisma.InputJsonValue;
  runAt?: Date;
  /** One live job per key; re-enqueueing a key that is QUEUED/RUNNING is a no-op. */
  dedupeKey?: string;
  maxAttempts?: number;
}

export async function enqueueJob(prisma: PrismaClient, input: EnqueueInput): Promise<string> {
  if (input.dedupeKey) {
    const existing = await prisma.job.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (existing && (existing.status === "QUEUED" || existing.status === "RUNNING"))
      return existing.id;
    if (existing) {
      // Finished or failed earlier: requeue the same row so the key stays unique.
      const j = await prisma.job.update({
        where: { id: existing.id },
        data: {
          status: "QUEUED",
          payload: input.payload,
          runAt: input.runAt ?? new Date(),
          attempts: 0,
          lastError: null,
          lockedAt: null,
        },
      });
      return j.id;
    }
  }
  const j = await prisma.job.create({
    data: {
      tenantId: input.tenantId,
      type: input.type,
      payload: input.payload,
      runAt: input.runAt ?? new Date(),
      dedupeKey: input.dedupeKey ?? null,
      ...(input.maxAttempts ? { maxAttempts: input.maxAttempts } : {}),
    },
  });
  return j.id;
}

/**
 * Claims up to `limit` due jobs. Each claim is a conditional update (still QUEUED, or still the
 * same stale RUNNING lock), so two overlapping cron runs, or a cron run plus an inline run after
 * a click, never take the same job: D1 applies writes one at a time and only one update matches.
 * Jobs stuck in RUNNING longer than `staleAfterMs` (the request was cut off) are reclaimed.
 */
export async function claimJobs(
  prisma: PrismaClient,
  opts: {
    limit: number;
    types?: JobType[];
    ids?: string[];
    staleAfterMs?: number;
    now?: Date;
  },
): Promise<ClaimedJob[]> {
  const now = opts.now ?? new Date();
  const stale = new Date(now.getTime() - (opts.staleAfterMs ?? 10 * 60_000));
  const candidates = await prisma.job.findMany({
    where: {
      OR: [
        { status: "QUEUED", runAt: { lte: now } },
        { status: "RUNNING", lockedAt: { lt: stale } },
      ],
      ...(opts.types ? { type: { in: opts.types } } : {}),
      ...(opts.ids ? { id: { in: opts.ids } } : {}),
    },
    orderBy: { runAt: "asc" },
    take: opts.limit * 3,
    select: { id: true, status: true, lockedAt: true },
  });
  const claimed: ClaimedJob[] = [];
  for (const c of candidates) {
    if (claimed.length >= opts.limit) break;
    const won = await prisma.job.updateMany({
      where:
        c.status === "QUEUED"
          ? { id: c.id, status: "QUEUED" }
          : { id: c.id, status: "RUNNING", lockedAt: c.lockedAt },
      data: { status: "RUNNING", lockedAt: now, attempts: { increment: 1 } },
    });
    if (won.count !== 1) continue; // someone else got it first
    const j = await prisma.job.findUniqueOrThrow({
      where: { id: c.id },
      select: {
        id: true,
        tenantId: true,
        type: true,
        payload: true,
        attempts: true,
        maxAttempts: true,
      },
    });
    claimed.push({ ...j, type: j.type as JobType });
  }
  return claimed;
}

export async function completeJob(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: { status: "DONE", lockedAt: null, lastError: null },
  });
}

/** Exponential backoff: 1, 2, 4, 8 … minutes; FAILED after maxAttempts. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
}

export async function failJob(
  prisma: PrismaClient,
  job: Pick<ClaimedJob, "id" | "attempts" | "maxAttempts">,
  error: string,
  now: Date = new Date(),
): Promise<"retry" | "failed"> {
  const final = job.attempts >= job.maxAttempts;
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: final ? "FAILED" : "QUEUED",
      lockedAt: null,
      lastError: error.slice(0, 2000),
      ...(final ? {} : { runAt: new Date(now.getTime() + retryDelayMs(job.attempts)) }),
    },
  });
  return final ? "failed" : "retry";
}
