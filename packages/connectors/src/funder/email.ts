import type {
  EmailProvider,
  FunderConnector,
  OutboundEmail,
  PositionLine,
  Recipients,
  SubmissionPackage,
  SubmissionReceipt,
} from "../types";

/** Gmail rejects messages above 25 MB; base64 adds a third, so raw attachments must stay below this. */
export const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;

export const DEFAULT_CONFIDENTIALITY_NOTICE =
  "Confidentiality Notice\n\n" +
  "This message and any attachments contain confidential and privileged information belonging " +
  "to Ascend Fund. If you are not the intended recipient, you are hereby notified that any " +
  "review, use, disclosure, copying, or distribution of this email is strictly prohibited. If " +
  "you have received this email in error, please immediately notify the sender by reply email " +
  "and delete this email and all attached files from your system. Thank you.";

export function formatPositions(positions: PositionLine[]): string {
  return positions
    .filter((p) => p.funder.trim())
    .map((p) =>
      p.balance === null
        ? p.funder.trim()
        : `${p.funder.trim()}: $${p.balance.toLocaleString("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          })}`,
    )
    .join("\n");
}

export interface SubmissionEmailOptions {
  from: string;
  confidentialityNotice?: string;
}

/**
 * Reproduces Ascend Fund's house submission email exactly as the team sends it today:
 * subject "New Deal Submission - <Merchant>", a short greeting, the existing positions as
 * "funder: $balance" lines, an optional note, then the confidentiality notice.
 */
export function buildSubmissionEmail(
  pkg: SubmissionPackage,
  recipients: Recipients,
  opts: SubmissionEmailOptions,
): OutboundEmail {
  const sections = ["Hello,", "Please see the attached deal for submission."];
  const positions = formatPositions(pkg.positions);
  if (positions) sections.push(positions);
  if (pkg.note?.trim()) sections.push(pkg.note.trim());
  if (pkg.links?.length) {
    sections.push(
      "Files (shared from Google Drive because they are too large to attach):\n" +
        pkg.links.map((l) => `${l.fileName}: ${l.url}`).join("\n"),
    );
  }
  sections.push("Thank you.");
  sections.push(opts.confidentialityNotice ?? DEFAULT_CONFIDENTIALITY_NOTICE);

  return {
    from: opts.from,
    to: [...recipients.to],
    cc: [...recipients.cc],
    subject: `New Deal Submission - ${pkg.merchantName.trim()}`,
    text: sections.join("\n\n"),
    attachments: pkg.links?.length ? [] : pkg.attachments,
    correlationId: pkg.submissionId,
  };
}

export function totalBytes(pkg: Pick<SubmissionPackage, "attachments">): number {
  return pkg.attachments.reduce((n, a) => n + a.data.length, 0);
}

export class EmailFunderConnector implements FunderConnector {
  readonly channel = "EMAIL" as const;

  constructor(
    private readonly email: EmailProvider,
    private readonly opts: SubmissionEmailOptions,
  ) {}

  async submit(pkg: SubmissionPackage, recipients: Recipients): Promise<SubmissionReceipt> {
    if (!pkg.links?.length && totalBytes(pkg) > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        "attachments exceed the Gmail size limit; share them from Drive and pass `links` instead",
      );
    }
    const sent = await this.email.send(buildSubmissionEmail(pkg, recipients, this.opts));
    return {
      channel: "EMAIL",
      externalRef: sent.threadId,
      messageId: sent.messageId,
      sentAt: new Date(),
    };
  }
}
