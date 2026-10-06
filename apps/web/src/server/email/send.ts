import type { Attachment } from "@mca/connectors";
import type { PrismaClient } from "@mca/db";
import { emailDryRun } from "../env";
import { tenantMailbox } from "../google";

export interface TrackedEmail {
  tenantId: string;
  dealId: string;
  /** Rule or action that sent it, recorded on the deal timeline (append-only). */
  kind: string;
  target: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  attachments?: Attachment[];
  /** Reply in this Gmail thread (lender follow-ups, contract requests). */
  threadId?: string | null;
  /** Gmail id of the message being answered, for In-Reply-To. */
  replyToGmailId?: string | null;
  userId?: string | null;
  /** When the rule ran (defaults to now); used for the "already sent" record. */
  at?: Date;
}

/**
 * Every automated or one-click email goes through here: dry-run aware, threaded when replying,
 * logged as an Activity, and recorded as a DealEvent so rules can count what they already sent.
 * Like lender submissions, there is no BCC.
 */
export async function sendTracked(
  prisma: PrismaClient,
  e: TrackedEmail,
): Promise<{ dryRun: boolean; messageId: string | null }> {
  if (e.to.length === 0) throw new Error("no recipient");
  let messageId: string | null = null;
  let threadId = e.threadId ?? null;
  const dryRun = emailDryRun();
  if (!dryRun) {
    const mailbox = await tenantMailbox(prisma, e.tenantId);
    const inReplyTo = e.replyToGmailId
      ? ((await mailbox.gmail.getMessage(e.replyToGmailId)).rfcMessageId ?? undefined)
      : undefined;
    const sent = await mailbox.gmail.send({
      from: e.from,
      to: e.to,
      cc: e.cc,
      subject: e.subject,
      text: e.text,
      attachments: e.attachments,
      threadId: threadId ?? undefined,
      inReplyTo,
      correlationId: `${e.kind}:${e.target}`,
    });
    messageId = sent.messageId;
    threadId = sent.threadId;
  }
  await prisma.$transaction([
    prisma.activity.create({
      data: {
        tenantId: e.tenantId,
        dealId: e.dealId,
        type: "EMAIL",
        direction: "OUTBOUND",
        userId: e.userId ?? null,
        subject: `${dryRun ? "[DRY RUN] " : ""}${e.subject}`.slice(0, 500),
        body:
          e.text +
          (e.attachments?.length
            ? `\n\n--- Attachments ---\n${e.attachments.map((a) => a.fileName).join("\n")}`
            : ""),
        fromAddress: e.from,
        toAddress: `To: ${e.to.join(", ")}${e.cc.length ? ` | Cc: ${e.cc.join(", ")}` : ""}`,
        externalId: messageId ?? `dry-run:${e.kind}:${e.target}:${Date.now()}`,
        threadId,
      },
    }),
    prisma.dealEvent.create({
      data: {
        dealId: e.dealId,
        type: "email_rule_sent",
        actorType: e.userId ? "user" : "system",
        actorId: e.userId ?? null,
        payload: { kind: e.kind, target: e.target, dryRun, to: e.to, cc: e.cc },
        ...(e.at ? { createdAt: e.at } : {}),
      },
    }),
  ]);
  return { dryRun, messageId };
}

/** How many times (and when last) a rule already sent to this target. */
export async function sentHistory(
  prisma: PrismaClient,
  dealId: string,
  kind: string,
  target: string,
) {
  const events = await prisma.dealEvent.findMany({
    where: {
      dealId,
      type: "email_rule_sent",
      AND: [
        { payload: { path: ["kind"], equals: kind } },
        { payload: { path: ["target"], equals: target } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return { count: events.length, last: events[0]?.createdAt ?? null };
}
