import type { InboundEmail } from "@mca/connectors";
import {
  asList,
  enqueueJob,
  merchantIdsByName,
  type ClaimedJob,
  type MailboxConnection,
  type Prisma,
  type PrismaClient,
} from "@mca/db";
import { allowedEmailDomain } from "../env";
import { storeDealFile } from "../documents";
import { positionsFromSubmissionBody } from "../submissions";
import { mailboxFor, type Mailbox } from "../google";
import {
  domainOf,
  fundersAddressed,
  routeMessage,
  subjectMentions,
  type FunderDomains,
} from "../inbox/route";
import { PermanentJobError } from "./errors";

export interface InboxSyncPayload {
  mailboxId: string;
}

const CLOSED_STAGES = ["FUNDED", "DECLINED", "DEAD"] as const;
const MAX_BODY = 50_000;

export interface InboxCtx {
  prisma: PrismaClient;
  mailbox: Mailbox;
  tenantId: string;
  funders: FunderDomains[];
  ownDomain: string;
  /**
   * Reading a history mailbox: deals, lenders, replies and positions only. No merchant mail,
   * no attachments (files live in the funding mailbox's Drive).
   */
  history: boolean;
  /** What this run imported (shown in Settings for history imports). */
  stats: { submissions: number; replies: number; positions: number };
}
type Ctx = InboxCtx;

export async function inboxContext(
  prisma: PrismaClient,
  connection: MailboxConnection,
  opts: { history: boolean },
): Promise<InboxCtx> {
  const funders = await prisma.funder.findMany({
    where: { tenantId: connection.tenantId, isActive: true },
    select: { id: true, name: true, emailDomains: true },
  });
  return {
    prisma,
    mailbox: mailboxFor(connection),
    tenantId: connection.tenantId,
    funders: funders.map((f) => ({ ...f, emailDomains: asList(f.emailDomains) })),
    ownDomain: domainOf(connection.email) || allowedEmailDomain(),
    history: opts.history,
    stats: { submissions: 0, replies: 0, positions: 0 },
  };
}

/**
 * "Check the email": reads new mail on funding@ since the last Gmail historyId and
 *  - imports hand-sent "New Deal Submission - X" emails as deals with one row per lender,
 *  - attaches lender replies to their submission and queues A8 parsing,
 *  - files merchant attachments into the deal's Drive folder.
 * Idempotent per Gmail message id, so a retried sync never duplicates anything.
 */
export async function handleInboxSync(prisma: PrismaClient, job: ClaimedJob): Promise<void> {
  const { mailboxId } = job.payload as unknown as InboxSyncPayload;
  const connection = await prisma.mailboxConnection.findUnique({ where: { id: mailboxId } });
  if (!connection) throw new PermanentJobError(`mailbox ${mailboxId} not found`);
  if (connection.purpose === "history") return; // read by HISTORY_IMPORT instead
  const ctx = await inboxContext(prisma, connection, { history: false });

  const { messages, nextCursor } = await ctx.mailbox.gmail.sync(connection.historyId);
  for (const m of messages) await ingest(ctx, m);
  await prisma.mailboxConnection.update({
    where: { id: connection.id },
    data: { historyId: nextCursor, lastSyncedAt: new Date() },
  });
}

/** Files one email. Safe to repeat, and the same email read from two mailboxes counts once. */
export async function ingest(ctx: Ctx, m: InboundEmail): Promise<void> {
  const { prisma } = ctx;
  const seen = await prisma.activity.findFirst({
    where: {
      tenantId: ctx.tenantId,
      OR: [
        { externalId: m.messageId },
        ...(m.rfcMessageId ? [{ rfcMessageId: m.rfcMessageId }] : []),
      ],
    },
  });
  if (seen) return;

  const route = routeMessage(m, ctx);
  if (route.kind === "ignore") return;
  if (route.kind === "outbound_submission") return importOutbound(ctx, m, route.merchantName);
  if (route.kind === "funder") return ingestFunderMail(ctx, m, route.funderId);
  if (ctx.history) return; // merchants' mail stays in the funding inbox's hands
  return ingestExternal(ctx, m);
}

async function logActivity(
  ctx: Ctx,
  m: InboundEmail,
  dealId: string | null,
  direction: "INBOUND" | "OUTBOUND",
) {
  return ctx.prisma.activity.create({
    data: {
      tenantId: ctx.tenantId,
      dealId,
      type: "EMAIL",
      direction,
      subject: m.subject.slice(0, 500),
      body: m.text.slice(0, MAX_BODY),
      externalId: m.messageId,
      rfcMessageId: m.rfcMessageId,
      threadId: m.threadId,
      fromAddress: m.from,
      toAddress: [...m.to, ...m.cc.map((c) => `cc:${c}`)].join(", ").slice(0, 2000),
      occurredAt: m.receivedAt,
    },
  });
}

async function saveAttachments(
  ctx: Ctx,
  m: InboundEmail,
  deal: { id: string; merchantId: string },
  via: "email" | "funder_email",
) {
  const ids: string[] = [];
  for (const a of m.attachments) {
    if (a.sizeBytes > 25 * 1024 * 1024) continue;
    const data = await ctx.mailbox.gmail.getAttachment(m.messageId, a.attachmentId);
    const doc = await storeDealFile(ctx.prisma, ctx.mailbox, {
      tenantId: ctx.tenantId,
      dealId: deal.id,
      merchantId: deal.merchantId,
      file: { fileName: a.fileName, mimeType: a.mimeType, data },
      uploadedVia: via,
      gmailMessageId: m.messageId,
    });
    ids.push(doc.id);
  }
  return ids;
}

/** A deal the team emailed to lenders straight from Gmail: create it so it is tracked here too. */
async function importOutbound(ctx: Ctx, m: InboundEmail, merchantName: string) {
  const { prisma, tenantId } = ctx;
  // Sent by the CRM itself: already tracked.
  if (await prisma.submission.findFirst({ where: { gmailMessageId: m.messageId } })) return;

  const [matchId] = await merchantIdsByName(prisma, tenantId, merchantName, { includeDba: true });
  const merchant =
    (matchId ? await prisma.merchant.findUnique({ where: { id: matchId } }) : null) ??
    (await prisma.merchant.create({ data: { tenantId, legalName: merchantName } }));

  const deal =
    (await prisma.deal.findFirst({
      where: { tenantId, merchantId: merchant.id, stage: { notIn: [...CLOSED_STAGES] } },
      orderBy: { createdAt: "desc" },
    })) ??
    (await prisma.deal.create({
      data: {
        tenantId,
        merchantId: merchant.id,
        stage: "SUBMITTED",
        sourceThreadId: m.threadId,
        ...(ctx.history ? { source: "email_history" } : {}),
        createdAt: m.receivedAt,
      },
    }));

  await logActivity(ctx, m, deal.id, "OUTBOUND");
  const documentIds = ctx.history ? [] : await saveAttachments(ctx, m, deal, "email");

  // The positions the team told lenders: the newest email's block is the current one.
  const positions = positionsFromSubmissionBody(m.text);
  if (positions.length) {
    await prisma.deal.update({
      where: { id: deal.id },
      data: { submissionPositions: positions as unknown as Prisma.InputJsonArray },
    });
    await prisma.dealEvent.create({
      data: {
        dealId: deal.id,
        type: "positions_from_email",
        actorType: "system",
        payload: {
          at: m.receivedAt.toISOString(),
          positions: positions as unknown as Prisma.InputJsonArray,
        },
      },
    });
    ctx.stats.positions++;
  }

  for (const f of fundersAddressed(m, ctx.funders)) {
    const exists = await prisma.submission.findFirst({
      where: { dealId: deal.id, funderId: f.id },
    });
    if (exists) continue;
    const lenderAddrs = [...m.to, ...m.cc].filter((a) => f.emailDomains.includes(domainOf(a)));
    await prisma.submission.create({
      data: {
        dealId: deal.id,
        funderId: f.id,
        channel: "EMAIL",
        status: "SENT",
        sentAt: m.receivedAt,
        // A history mailbox's thread ids mean nothing to the funding mailbox: leave them empty
        // so no follow-up or contract request is ever sent into them.
        gmailThreadId: ctx.history ? null : m.threadId,
        gmailMessageId: ctx.history ? null : m.messageId,
        toAddresses: lenderAddrs.slice(0, 1),
        ccAddresses: [
          ...lenderAddrs.slice(1),
          ...m.cc.filter((a) => domainOf(a) === ctx.ownDomain),
        ],
        packageDocumentIds: documentIds,
        rawStatusLog: [{ at: m.receivedAt.toISOString(), status: "SENT", importedFromGmail: true }],
      },
    });
    ctx.stats.submissions++;
  }
  if (
    deal.stage === "INTAKE" ||
    deal.stage === "READY_TO_SUBMIT" ||
    deal.stage === "DOCS_RECEIVED"
  ) {
    await prisma.deal.update({
      where: { id: deal.id },
      data: { stage: "SUBMITTED", stageChangedAt: new Date() },
    });
  }
}

async function ingestFunderMail(ctx: Ctx, m: InboundEmail, funderId: string) {
  const { prisma } = ctx;
  const include = { deal: { include: { merchant: true } } } as const;
  let sub = await prisma.submission.findFirst({
    where: { funderId, gmailThreadId: m.threadId },
    include,
  });
  if (!sub) {
    // Lenders often reply in a new thread; match on the merchant name in the subject.
    const open = await prisma.submission.findMany({
      where: { funderId, deal: { tenantId: ctx.tenantId, stage: { notIn: [...CLOSED_STAGES] } } },
      include,
      orderBy: { sentAt: "desc" },
      take: 200,
    });
    sub =
      open.find((s) =>
        subjectMentions(m.subject, [s.deal.merchant.legalName, s.deal.merchant.dba]),
      ) ?? null;
  }

  const activity = await logActivity(ctx, m, sub?.dealId ?? null, "INBOUND");
  if (!sub) return; // lender blast or unknown deal: kept in the inbox list, not parsed

  if (m.attachments.length && !ctx.history) await saveAttachments(ctx, m, sub.deal, "funder_email");
  await prisma.submission.update({
    where: { id: sub.id },
    data: { lastFunderMessageAt: m.receivedAt },
  });
  await enqueueJob(prisma, {
    tenantId: ctx.tenantId,
    type: "PARSE_REPLY",
    payload: {
      activityId: activity.id,
      submissionId: sub.id,
      ...(ctx.history ? { history: true } : {}),
    },
    dedupeKey: `reply:${m.rfcMessageId ?? m.messageId}`,
  });
  ctx.stats.replies++;
}

/** Merchant sending statements/MTD/stips: file them on the merchant's open deal. */
async function ingestExternal(ctx: Ctx, m: InboundEmail) {
  const { prisma, tenantId } = ctx;
  const merchant = await prisma.merchant.findFirst({
    where: {
      tenantId,
      OR: [
        // Emails are stored lower-case.
        { email: m.from.toLowerCase() },
        { owners: { some: { email: m.from.toLowerCase() } } },
      ],
    },
  });
  if (!merchant) return; // unknown sender: never auto-create deals from arbitrary mail
  const deal = await prisma.deal.findFirst({
    where: { tenantId, merchantId: merchant.id, stage: { notIn: [...CLOSED_STAGES] } },
    orderBy: { createdAt: "desc" },
  });
  await logActivity(ctx, m, deal?.id ?? null, "INBOUND");
  if (deal && m.attachments.length) await saveAttachments(ctx, m, deal, "email");
}
