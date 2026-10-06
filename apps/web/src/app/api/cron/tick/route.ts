import { timingSafeEqual } from "node:crypto";
import { enqueueJob, getPrisma } from "@mca/db";
import { runDueJobs } from "@/server/jobs/runner";

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
 * Heartbeat called by Supabase Cron every 2 minutes (and by Vercel Cron once a day as a
 * fallback): queues an inbox check per connected mailbox, then works through due jobs for
 * up to ~45 s so the function finishes inside Vercel's limit.
 */
async function tick(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const prisma = getPrisma();
  const mailboxes = await prisma.mailboxConnection.findMany({
    select: { id: true, tenantId: true },
  });
  for (const m of mailboxes) {
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
  }
  const result = await runDueJobs(prisma, { budgetMs: 45_000 });
  return Response.json({
    mailboxes: mailboxes.length,
    done: result.done.length,
    retried: result.retried,
    failed: result.failed,
  });
}

export const GET = tick;
export const POST = tick;
