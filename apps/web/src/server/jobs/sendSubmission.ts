import {
  buildSubmissionEmail,
  EmailFunderConnector,
  MAX_ATTACHMENT_BYTES,
  type Attachment,
  type PositionLine,
  type SubmissionPackage,
} from "@mca/connectors";
import type { ClaimedJob, Prisma, PrismaClient } from "@mca/db";
import { emailDryRun } from "../env";
import { tenantMailbox } from "../google";
import { PermanentJobError } from "./errors";

export interface SendSubmissionPayload {
  submissionId: string;
}

export function merchantDisplayName(m: { legalName: string; dba: string | null }): string {
  return m.dba ?? m.legalName;
}

/**
 * Sends ONE lender's copy of the deal. Recipients were fixed when the rep clicked Send and are
 * stored on the Submission: To = the lender's first address, CC = its other addresses + team.
 * No BCC exists anywhere in this path.
 */
export async function handleSendSubmission(prisma: PrismaClient, job: ClaimedJob): Promise<void> {
  const { submissionId } = job.payload as unknown as SendSubmissionPayload;
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { deal: { include: { merchant: true, tenant: true } }, funder: true },
  });
  if (!sub) throw new PermanentJobError(`submission ${submissionId} not found`);
  if (sub.status !== "DRAFT") return; // already sent (or withdrawn): never send twice
  if (sub.toAddresses.length !== 1) {
    throw new PermanentJobError(`submission ${submissionId} must have exactly one To address`);
  }

  const deal = sub.deal;
  const merchantName = merchantDisplayName(deal.merchant);
  const recipients = { to: sub.toAddresses, cc: sub.ccAddresses };
  const docs = await prisma.document.findMany({
    where: { id: { in: sub.packageDocumentIds }, dealId: deal.id },
  });
  if (docs.length !== sub.packageDocumentIds.length) {
    throw new PermanentJobError("some selected files are no longer on this deal");
  }
  const basePkg: Omit<SubmissionPackage, "attachments"> = {
    dealId: deal.id,
    submissionId: sub.id,
    funderName: sub.funder.name,
    merchantName,
    positions: (deal.submissionPositions ?? []) as unknown as PositionLine[],
    note: deal.submissionNote ?? undefined,
  };

  if (emailDryRun()) {
    const from = deal.tenant.fromAddress ?? "funding@example.invalid";
    const email = buildSubmissionEmail({ ...basePkg, attachments: [] }, recipients, { from });
    const logged = await prisma.activity.findFirst({ where: { externalId: `dry-run:${sub.id}` } });
    if (!logged)
      await prisma.activity.create({
        data: {
          tenantId: deal.tenantId,
          dealId: deal.id,
          type: "EMAIL",
          direction: "OUTBOUND",
          userId: sub.sentById,
          subject: `[DRY RUN] ${email.subject}`,
          body: `${email.text}\n\n--- Attachments ---\n${docs.map((d) => d.fileName).join("\n")}`,
          fromAddress: from,
          toAddress: `To: ${email.to.join(", ")} | Cc: ${email.cc.join(", ")}`,
          externalId: `dry-run:${sub.id}`,
        },
      });
    await markSent(prisma, sub.id, deal.id, sub.funder.name, {
      messageId: null,
      threadId: null,
      dryRun: true,
    });
    return;
  }

  const mailbox = await tenantMailbox(prisma, deal.tenantId);
  const from = deal.tenant.fromAddress ?? mailbox.connection.email;
  const subject = `New Deal Submission - ${merchantName.trim()}`;

  // A previous attempt may have reached Gmail and then died before saving. Look in Sent first.
  if (sub.externalRef?.startsWith("sending:")) {
    const since = Math.floor(Number(sub.externalRef.slice("sending:".length)) / 1000) - 120;
    const q = `in:sent to:${recipients.to[0]} subject:"${subject.replace(/"/g, "")}" after:${since}`;
    const [id] = await mailbox.gmail.search(q, 1);
    if (id) {
      const m = await mailbox.gmail.getMessage(id);
      await markSent(prisma, sub.id, deal.id, sub.funder.name, {
        messageId: m.messageId,
        threadId: m.threadId,
      });
      return;
    }
  }

  const attachments: Attachment[] = [];
  for (const d of docs) {
    attachments.push({
      fileName: d.fileName,
      mimeType: d.mimeType,
      data: await mailbox.drive.download(d.driveFileId),
    });
  }
  const tooBig = attachments.reduce((n, a) => n + a.data.length, 0) > MAX_ATTACHMENT_BYTES;
  let links: SubmissionPackage["links"];
  if (tooBig) {
    // Share each file with this lender's own addresses only (named people, never a public link).
    const lenderAddresses = [
      ...recipients.to,
      ...recipients.cc.filter((e) => sub.funder.submissionCc.includes(e)),
    ];
    for (const d of docs) await mailbox.drive.shareWith(d.driveFileId, lenderAddresses);
    links = docs.map((d) => ({
      fileName: d.fileName,
      url: d.driveWebViewLink ?? `https://drive.google.com/file/d/${d.driveFileId}/view`,
    }));
  }

  await prisma.submission.update({
    where: { id: sub.id },
    data: { externalRef: `sending:${Date.now()}` },
  });
  const receipt = await new EmailFunderConnector(mailbox.gmail, { from }).submit(
    { ...basePkg, attachments: tooBig ? [] : attachments, links },
    recipients,
  );
  await markSent(prisma, sub.id, deal.id, sub.funder.name, {
    messageId: receipt.messageId ?? null,
    threadId: receipt.externalRef,
    viaDriveLinks: tooBig,
  });
}

async function markSent(
  prisma: PrismaClient,
  submissionId: string,
  dealId: string,
  funderName: string,
  r: {
    messageId: string | null;
    threadId: string | null;
    dryRun?: boolean;
    viaDriveLinks?: boolean;
  },
) {
  const now = new Date();
  const entry = {
    at: now.toISOString(),
    status: "SENT",
    dryRun: r.dryRun ?? false,
  } as Prisma.InputJsonObject;
  await prisma.$transaction([
    prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: "SENT",
        sentAt: now,
        gmailMessageId: r.messageId,
        gmailThreadId: r.threadId,
        externalRef: r.dryRun ? "dry-run" : r.threadId,
        rawStatusLog: [entry],
      },
    }),
    prisma.dealEvent.create({
      data: {
        dealId,
        type: "submission_sent",
        actorType: "system",
        payload: {
          submissionId,
          funderName,
          dryRun: r.dryRun ?? false,
          viaDriveLinks: r.viaDriveLinks ?? false,
        },
      },
    }),
  ]);
}
