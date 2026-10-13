import type { ClaimedJob, Prisma, PrismaClient } from "@mca/db";
import { inboxContext, ingest } from "./inboxSync";
import { PermanentJobError } from "./errors";

export interface HistoryImportPayload {
  mailboxId: string;
}

export interface HistoryImportState {
  /** Gmail message ids to read, oldest first. */
  ids?: string[];
  done?: number;
  total?: number;
  startedAt?: string;
  finishedAt?: string;
  imported?: { submissions: number; replies: number; positions: number };
}

/** One run reads for this long; the next cron tick continues where it stopped. */
const RUN_MS = 25_000;
const BATCH = 10;

/** Submissions and anything lenders wrote back, in every folder (sent mail included). */
export function historyQuery(lenderDomains: string[]): string {
  const from = lenderDomains.length ? ` OR from:(${lenderDomains.join(" OR ")})` : "";
  return `in:anywhere -in:drafts -in:spam -in:trash (subject:"New Deal Submission"${from})`;
}

/**
 * Learns from a team mailbox's past mail (read-only): each "New Deal Submission" becomes a deal
 * with one row per lender and its positions block, and lender replies are queued for A8, which
 * records approvals, declines and reasons, offers and fundings. Oldest mail first, so replies
 * find the submission they answer. Resumable: progress is saved after every batch.
 */
export async function handleHistoryImport(
  prisma: PrismaClient,
  job: ClaimedJob,
  opts: { runMs?: number } = {},
): Promise<void> {
  const { mailboxId } = job.payload as unknown as HistoryImportPayload;
  const connection = await prisma.mailboxConnection.findUnique({ where: { id: mailboxId } });
  if (!connection) throw new PermanentJobError(`mailbox ${mailboxId} not found`);
  if (connection.purpose !== "history") {
    throw new PermanentJobError(`mailbox ${connection.email} is not a history mailbox`);
  }
  let state = (connection.importState ?? {}) as HistoryImportState;
  if (state.finishedAt) return;

  const ctx = await inboxContext(prisma, connection, { history: true });
  const save = (s: HistoryImportState) =>
    prisma.mailboxConnection.update({
      where: { id: connection.id },
      data: { importState: s as unknown as Prisma.InputJsonObject, lastSyncedAt: new Date() },
    });

  if (!state.ids) {
    const domains = [...new Set(ctx.funders.flatMap((f) => f.emailDomains))];
    const ids = (await ctx.mailbox.gmail.searchAll(historyQuery(domains))).reverse();
    state = {
      ids,
      done: 0,
      total: ids.length,
      startedAt: new Date().toISOString(),
      imported: { submissions: 0, replies: 0, positions: 0 },
    };
    await save(state);
  }

  const ids = state.ids!;
  const stopAt = Date.now() + (opts.runMs ?? RUN_MS);
  let done = state.done ?? 0;
  const imported = state.imported ?? { submissions: 0, replies: 0, positions: 0 };
  while (done < ids.length && Date.now() < stopAt) {
    const batch = ids.slice(done, done + BATCH);
    const messages = await Promise.all(batch.map((id) => ctx.mailbox.gmail.getMessage(id)));
    messages.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    for (const m of messages) await ingest(ctx, m);
    done += batch.length;
    imported.submissions += ctx.stats.submissions;
    imported.replies += ctx.stats.replies;
    imported.positions += ctx.stats.positions;
    ctx.stats = { submissions: 0, replies: 0, positions: 0 };
    state = { ...state, done, imported };
    await save(state);
  }
  if (done >= ids.length) {
    // The id list is only needed while reading.
    await save({ ...state, ids: undefined, finishedAt: new Date().toISOString() });
  }
}
