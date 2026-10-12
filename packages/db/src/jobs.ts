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
 * Atomically claims up to `limit` due jobs. `FOR UPDATE SKIP LOCKED` means two overlapping
 * cron ticks (or a tick plus an inline run after a button click) never take the same job.
 * Jobs stuck in RUNNING longer than `staleAfterMs` (function timed out) are reclaimed.
 */
export async function claimJobs(
  prisma: PrismaClient,
  opts: { limit: number; types?: JobType[]; ids?: string[]; staleAfterMs?: number },
): Promise<ClaimedJob[]> {
  const staleSeconds = Math.round((opts.staleAfterMs ?? 10 * 60_000) / 1000);
  const types = opts.types ?? null;
  const ids = opts.ids ?? null;
  return prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "Job" SET status = 'RUNNING', "lockedAt" = now(), attempts = attempts + 1, "updatedAt" = now()
    WHERE id IN (
      SELECT id FROM "Job"
      WHERE (
        (status = 'QUEUED' AND "runAt" <= now())
        OR (status = 'RUNNING' AND "lockedAt" < now() - make_interval(secs => ${staleSeconds}))
      )
      AND (${types}::text[] IS NULL OR type = ANY(${types}::text[]))
      AND (${ids}::text[] IS NULL OR id = ANY(${ids}::text[]))
      ORDER BY "runAt"
      LIMIT ${opts.limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "tenantId", type, payload, attempts, "maxAttempts"`;
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
