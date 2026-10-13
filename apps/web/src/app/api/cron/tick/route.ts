import { timingSafeEqual } from "node:crypto";
import { tickBudgetMs } from "@/server/env";
import { enqueueJob, getPrisma } from "@mca/db";
import { runDueJobs } from "@/server/jobs/runner";
import { whatsappConfigured } from "@/server/whatsapp/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Heartbeat run by the Worker's Cron Trigger every 2 minutes (worker.ts calls it in-process with
 * CRON_SECRET): queues an inbox check per funding mailbox (and the next batch of any history
 * import) and the automation jobs, then works
 * through due jobs for TICK_BUDGET_MS.
 */
async function tick(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const prisma = getPrisma();
  const mailboxes = await prisma.mailboxConnection.findMany({
    select: { id: true, tenantId: true, purpose: true, importState: true },
  });
  for (const m of mailboxes) {
    if (m.purpose === "history") {
      // Past mail is imported a batch per tick until done.
      if ((m.importState as { finishedAt?: string } | null)?.finishedAt) continue;
      await enqueueJob(prisma, {
        tenantId: m.tenantId,
        type: "HISTORY_IMPORT",
        payload: { mailboxId: m.id },
        dedupeKey: `history:${m.id}`,
      });
      continue;
    }
    await enqueueJob(prisma, {
      tenantId: m.tenantId,
      type: "INBOX_SYNC",
      payload: { mailboxId: m.id },
      dedupeKey: `sync:${m.id}`,
    });
  }
  // Automated emails (missing docs, stip chases, lender follow-ups) for every tenant.
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const t of tenants) {
    await enqueueJob(prisma, {
      tenantId: t.id,
      type: "EMAIL_RULES",
      payload: {},
      dedupeKey: `rules:${t.id}`,
    });
    // WhatsApp applications: reminders and any message left unprocessed.
    if (whatsappConfigured()) {
      await enqueueJob(prisma, {
        tenantId: t.id,
        type: "WHATSAPP_NUDGES",
        payload: {},
        dedupeKey: `wanudge:${t.id}`,
      });
    }
  }
  const result = await runDueJobs(prisma, { budgetMs: tickBudgetMs() });
  return Response.json({
    mailboxes: mailboxes.length,
    done: result.done.length,
    retried: result.retried,
    failed: result.failed,
  });
}

export const GET = tick;
export const POST = tick;
