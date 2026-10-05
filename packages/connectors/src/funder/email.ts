import type {
  EmailProvider,
  FunderConnector,
  SubmissionPackage,
  SubmissionReceipt,
} from "../types";

/**
 * Industry convention: subject "Merchant Name / ISO Name", signed app + statements + voided
 * check + ID attached, short factual body. This is the universal v1 channel.
 */
export function buildSubmissionEmail(pkg: SubmissionPackage, to: string, from: string) {
  const subject = `${pkg.merchantLegalName} / ${pkg.isoName}`;
  const amount =
    pkg.requestedAmount !== null
      ? `Requested: $${pkg.requestedAmount.toLocaleString("en-US")}\n`
      : "";
  const text =
    `New submission for ${pkg.programName}.\n\n` +
    `Merchant: ${pkg.merchantLegalName}\n` +
    amount +
    `\n${pkg.processorSummary}\n\n` +
    `Attached: ${pkg.attachments.map((a) => a.fileName).join(", ")}\n\n` +
    `Submitted by ${pkg.isoName}. Ref ${pkg.watermarkTag}.`;
  return {
    from,
    to: [to],
    subject,
    text,
    attachments: pkg.attachments,
    correlationId: pkg.submissionId,
  };
}

export class EmailFunderConnector implements FunderConnector {
  readonly channel = "EMAIL" as const;

  constructor(
    private readonly email: EmailProvider,
    private readonly opts: { submissionAddress: string; fromAddress: string },
  ) {}

  async submit(pkg: SubmissionPackage): Promise<SubmissionReceipt> {
    const msg = buildSubmissionEmail(pkg, this.opts.submissionAddress, this.opts.fromAddress);
    const sent = await this.email.send(msg);
    return { channel: "EMAIL", externalRef: sent.threadId, sentAt: new Date() };
  }
}
