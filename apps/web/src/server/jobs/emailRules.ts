import type { ClaimedJob, EmailRule, PrismaClient } from "@mca/db";
import { ensureRules, isWeekendNY, renderTemplate, type RuleKind } from "../email/rules";
import { sendTracked, sentHistory } from "../email/send";

export interface EmailRulesPayload {
  tenantId?: string;
}

const OPEN_STAGES = [
  "INTAKE",
  "DOCS_REQUESTED",
  "DOCS_RECEIVED",
  "PRE_UNDERWRITING",
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "OFFERS_RECEIVED",
  "OFFER_ACCEPTED",
  "STIPS",
  "CONTRACT_OUT",
] as const;
/** Cap per run so one tick never floods Gmail; the next tick continues. */
const MAX_SENDS_PER_RUN = 20;
const HOUR = 3_600_000;

export interface RuleRunResult {
  sent: { kind: RuleKind; dealId: string; target: string }[];
}

/**
 * Automated emails, checked on every cron tick (one live job per tenant):
 * missing documents and stip chases to the merchant, one follow-up to quiet lenders.
 * Draft-only rules (contract request, clawback confirmation) are sent from the deal page.
 */
export async function handleEmailRules(prisma: PrismaClient, job: ClaimedJob): Promise<void> {
  await runEmailRules(prisma, job.tenantId, new Date());
}

export async function runEmailRules(
  prisma: PrismaClient,
  tenantId: string,
  now: Date,
): Promise<RuleRunResult> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const rules = new Map((await ensureRules(prisma, tenantId)).map((r) => [r.kind as RuleKind, r]));
  const from = tenant.fromAddress ?? "funding@example.invalid";
  const result: RuleRunResult = { sent: [] };
  const budget = () => result.sent.length < MAX_SENDS_PER_RUN;
  const active = (k: RuleKind): EmailRule | null => {
    const r = rules.get(k);
    return r && r.enabled && !r.requiresApproval ? r : null;
  };
  const due = (last: Date | null, since: Date, r: EmailRule) =>
    now.getTime() - (last ?? since).getTime() >= r.delayHours * HOUR;

  // 1. Missing documents → merchant.
  const missingRule = active("MISSING_DOCS");
  if (missingRule) {
    const deals = await prisma.deal.findMany({
      where: {
        tenantId,
        stage: { in: ["INTAKE", "DOCS_REQUESTED"] },
        merchant: { email: { not: null }, emailOptOut: false },
      },
      include: { merchant: { include: { owners: true } }, documents: { select: { type: true } } },
      take: 100,
    });
    for (const d of deals) {
      if (!budget()) break;
      const has = (t: string) => d.documents.some((x) => x.type === t);
      const missing = [
        ...(has("APPLICATION") ? [] : ["- Signed application"]),
        ...(has("BANK_STATEMENT")
          ? []
          : ["- Last 4 months of business bank statements (all pages, PDF)"]),
      ];
      if (missing.length === 0) continue;
      const h = await sentHistory(prisma, d.id, "MISSING_DOCS", d.id);
      if (h.count >= missingRule.maxSends || !due(h.last, d.createdAt, missingRule)) continue;
      const owner = d.merchant.owners.find((o) => o.isPrimary) ?? d.merchant.owners[0];
      const vars = {
        business: d.merchant.dba ?? d.merchant.legalName,
        contact: owner?.firstName ?? "there",
        missing: missing.join("\n"),
        broker: tenant.name,
      };
      await sendTracked(prisma, {
        at: now,
        tenantId,
        dealId: d.id,
        kind: "MISSING_DOCS",
        target: d.id,
        from,
        to: [d.merchant.email!],
        cc: [],
        subject: renderTemplate(missingRule.subject, vars),
        text: renderTemplate(missingRule.body, vars),
      });
      result.sent.push({ kind: "MISSING_DOCS", dealId: d.id, target: d.id });
    }
  }

  // 2. Stip chase → merchant (one email per deal listing every stip that is due).
  const stipRule = active("STIP_CHASE");
  if (stipRule) {
    const stips = await prisma.stipulation.findMany({
      where: {
        status: { in: ["REQUESTED", "SENT_TO_MERCHANT"] },
        chaseCount: { lt: stipRule.maxSends },
        OR: [{ nextChaseAt: null }, { nextChaseAt: { lte: now } }],
        deal: {
          tenantId,
          stage: { in: [...OPEN_STAGES] },
          merchant: { email: { not: null }, emailOptOut: false },
        },
      },
      include: { deal: { include: { merchant: { include: { owners: true } } } } },
      take: 200,
    });
    const byDeal = new Map<string, typeof stips>();
    for (const s of stips) byDeal.set(s.dealId, [...(byDeal.get(s.dealId) ?? []), s]);
    for (const [dealId, list] of byDeal) {
      if (!budget()) break;
      const deal = list[0]!.deal;
      // First chase waits delayHours after the lender asked, so the rep can answer first.
      const ready = list.filter(
        (s) =>
          s.chaseCount > 0 || now.getTime() - s.createdAt.getTime() >= stipRule.delayHours * HOUR,
      );
      if (ready.length === 0) continue;
      const owner = deal.merchant.owners.find((o) => o.isPrimary) ?? deal.merchant.owners[0];
      const vars = {
        business: deal.merchant.dba ?? deal.merchant.legalName,
        contact: owner?.firstName ?? "there",
        stips: ready.map((s) => `- ${s.name}`).join("\n"),
        broker: tenant.name,
      };
      const target = `${dealId}:${ready
        .map((s) => s.id)
        .sort()
        .join(",")}:${Math.max(...ready.map((s) => s.chaseCount))}`;
      await sendTracked(prisma, {
        at: now,
        tenantId,
        dealId,
        kind: "STIP_CHASE",
        target,
        from,
        to: [deal.merchant.email!],
        cc: [],
        subject: renderTemplate(stipRule.subject, vars),
        text: renderTemplate(stipRule.body, vars),
      });
      await prisma.stipulation.updateMany({
        where: { id: { in: ready.map((s) => s.id) } },
        data: {
          status: "SENT_TO_MERCHANT",
          chaseCount: { increment: 1 },
          nextChaseAt: new Date(now.getTime() + Math.max(1, stipRule.delayHours) * HOUR),
        },
      });
      result.sent.push({ kind: "STIP_CHASE", dealId, target });
    }
  }

  // 3. Lender follow-up → same thread, same To/CC, weekdays only.
  const followRule = active("LENDER_FOLLOW_UP");
  if (followRule && !isWeekendNY(now)) {
    const cutoff = new Date(now.getTime() - followRule.delayHours * HOUR);
    const subs = await prisma.submission.findMany({
      where: {
        status: { in: ["SENT", "ACKNOWLEDGED"] },
        sentAt: { lte: cutoff },
        gmailThreadId: { not: null },
        OR: [{ lastFunderMessageAt: null }, { lastFunderMessageAt: { lte: cutoff } }],
        deal: { tenantId, stage: { in: [...OPEN_STAGES] } },
      },
      include: { deal: { include: { merchant: true } } },
      take: 100,
    });
    for (const s of subs) {
      if (!budget()) break;
      const h = await sentHistory(prisma, s.dealId, "LENDER_FOLLOW_UP", s.id);
      if (h.count >= followRule.maxSends || !due(h.last, s.sentAt!, followRule)) continue;
      const vars = {
        business: s.deal.merchant.dba ?? s.deal.merchant.legalName,
        broker: tenant.name,
      };
      await sendTracked(prisma, {
        at: now,
        tenantId,
        dealId: s.dealId,
        kind: "LENDER_FOLLOW_UP",
        target: s.id,
        from,
        to: s.toAddresses,
        cc: s.ccAddresses,
        subject: renderTemplate(followRule.subject, vars),
        text: renderTemplate(followRule.body, vars),
        threadId: s.gmailThreadId,
        replyToGmailId: s.gmailMessageId,
      });
      result.sent.push({ kind: "LENDER_FOLLOW_UP", dealId: s.dealId, target: s.id });
    }
  }

  return result;
}
