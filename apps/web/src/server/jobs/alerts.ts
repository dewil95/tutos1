import type { PrismaClient } from "@mca/db";
import { emailDryRun } from "../env";
import { tenantMailbox } from "../google";

const ALERT_EVERY_MS = 60 * 60_000;

/**
 * Jobs that gave up (FAILED) are reported to each tenant's admins by email, at most once an
 * hour, with the plain-words error and a link to Settings → Recent failures. Nothing here can
 * fail the tick: every problem is logged and swallowed.
 */
export async function alertJobFailures(
  prisma: PrismaClient,
  failed: { id: string; error: string }[],
  settingsUrl: string,
  now: Date = new Date(),
): Promise<{ emailed: string[] }> {
  const emailed: string[] = [];
  if (failed.length === 0) return { emailed };
  const jobs = await prisma.job.findMany({
    where: { id: { in: failed.map((f) => f.id) } },
    select: { id: true, tenantId: true, type: true, lastError: true },
  });
  const byTenant = new Map<string, typeof jobs>();
  for (const j of jobs) byTenant.set(j.tenantId, [...(byTenant.get(j.tenantId) ?? []), j]);

  for (const [tenantId, list] of byTenant) {
    try {
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      if (
        tenant.lastFailureAlertAt &&
        now.getTime() - tenant.lastFailureAlertAt.getTime() < ALERT_EVERY_MS
      )
        continue;
      const admins = await prisma.user.findMany({
        where: { tenantId, isActive: true, role: { in: ["ADMIN", "MANAGER"] } },
        select: { email: true },
      });
      const to = admins.map((u) => u.email);
      if (to.length === 0 || !tenant.fromAddress) continue;
      const outstanding = await prisma.job.count({ where: { tenantId, status: "FAILED" } });
      const lines = list.map((j) => `- ${label(j.type)}: ${j.lastError ?? "no details"}`);
      const text = [
        `${list.length} background job${list.length === 1 ? "" : "s"} gave up in the CRM just now${
          outstanding > list.length ? ` (${outstanding} failed in total)` : ""
        }:`,
        "",
        ...lines,
        "",
        `See Settings → Recent failures: ${settingsUrl}`,
        'Fix the cause (for example the AI quota or key), then press "Retry failed jobs" there.',
        "",
        "You get at most one of these emails an hour.",
      ].join("\n");
      const subject = `Ascend CRM: ${list.length} job${list.length === 1 ? "" : "s"} failed`;
      if (emailDryRun()) {
        console.warn(`[alert] dry run, not emailing ${to.join(", ")}: ${subject}`);
      } else {
        const mailbox = await tenantMailbox(prisma, tenantId);
        await mailbox.gmail.send({
          from: tenant.fromAddress,
          to,
          cc: [],
          subject,
          text,
          correlationId: `alert:${now.toISOString()}`,
        });
      }
      await prisma.tenant.update({ where: { id: tenantId }, data: { lastFailureAlertAt: now } });
      emailed.push(...to);
    } catch (err) {
      console.error(
        `[alert] tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { emailed };
}

function label(type: string): string {
  return (
    {
      PARSE_REPLY: "Reading a lender reply",
      STATEMENT_EXTRACT: "Reading a bank statement",
      STATEMENT_SCRUB: "Bank scrub",
      APPLICATION_READ: "Reading an application",
      RISK_REPORT: "Risk report",
      SEND_SUBMISSION: "Sending to a lender",
      INBOX_SYNC: "Checking the inbox",
      HISTORY_IMPORT: "Learning from past email",
    }[type] ?? type
  );
}
