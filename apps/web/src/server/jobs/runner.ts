import {
  claimJobs,
  completeJob,
  failJob,
  type ClaimedJob,
  type JobType,
  type PrismaClient,
} from "@mca/db";
import { PermanentJobError } from "./errors";
import { handleInboxSync } from "./inboxSync";
import { handleParseReply } from "./parseReply";
import { handleSendSubmission } from "./sendSubmission";
import { handleStatementAnalysis } from "./statementAnalysis";

export type JobHandler = (prisma: PrismaClient, job: ClaimedJob) => Promise<void>;

const HANDLERS: Record<JobType, JobHandler> = {
  SEND_SUBMISSION: handleSendSubmission,
  INBOX_SYNC: handleInboxSync,
  PARSE_REPLY: handleParseReply,
  STATEMENT_ANALYSIS: handleStatementAnalysis,
};

export interface RunResult {
  done: string[];
  retried: { id: string; error: string }[];
  failed: { id: string; error: string }[];
}

/**
 * Claims and runs due jobs until `budgetMs` is spent. Called by /api/cron/tick (Supabase Cron
 * every 2 minutes) and right after a user action with `ids` so a click is handled immediately.
 * Each job is one unit of work, so a Vercel function never runs into its time limit mid-batch.
 */
export async function runDueJobs(
  prisma: PrismaClient,
  opts: { budgetMs: number; ids?: string[]; types?: JobType[]; batch?: number },
): Promise<RunResult> {
  const started = Date.now();
  const result: RunResult = { done: [], retried: [], failed: [] };
  const seen = new Set<string>();

  while (Date.now() - started < opts.budgetMs) {
    const jobs = await claimJobs(prisma, {
      limit: opts.batch ?? 3,
      ids: opts.ids,
      types: opts.types,
    });
    if (jobs.length === 0) break;
    await Promise.all(jobs.map((job) => runOne(prisma, job, result)));
    // With explicit ids, stop once each was attempted (a retry is due later, not now).
    if (opts.ids) {
      jobs.forEach((j) => seen.add(j.id));
      if (opts.ids.every((id) => seen.has(id))) break;
    }
  }
  return result;
}

async function runOne(prisma: PrismaClient, job: ClaimedJob, result: RunResult): Promise<void> {
  const handler = HANDLERS[job.type];
  try {
    if (!handler) throw new PermanentJobError(`unknown job type ${job.type}`);
    await handler(prisma, job);
    await completeJob(prisma, job.id);
    result.done.push(job.id);
  } catch (err) {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const permanent = err instanceof PermanentJobError;
    const outcome = await failJob(
      prisma,
      permanent ? { ...job, attempts: job.maxAttempts } : job,
      error,
    );
    (outcome === "failed" ? result.failed : result.retried).push({ id: job.id, error });
    console.error(`[job ${job.type} ${job.id}] attempt ${job.attempts}: ${error}`);
  }
}
