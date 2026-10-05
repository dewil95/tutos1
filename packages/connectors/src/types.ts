/**
 * Connector interfaces. Every external system the CRM talks to is behind one of these so a
 * vendor can be swapped (Dropbox Sign → DocuSign, Twilio → Kixie import) without touching
 * domain code. Implementations live in src/<capability>/<vendor>.ts.
 */

export interface Attachment {
  fileName: string;
  mimeType: string;
  data: Buffer;
}

// --- Funder submission ----------------------------------------------------

export type SubmissionChannel = "EMAIL" | "PORTAL" | "API";

export interface SubmissionPackage {
  dealId: string;
  submissionId: string;
  funderName: string;
  programName: string;
  merchantLegalName: string;
  isoName: string;
  requestedAmount: number | null;
  processorSummary: string;
  attachments: Attachment[];
  /** e.g. "ISO-ACME/FUNDER-A/2026-10-05" burned into PDFs for backdoor tracing */
  watermarkTag: string;
}

export interface SubmissionReceipt {
  channel: SubmissionChannel;
  externalRef: string;
  sentAt: Date;
}

export interface FunderConnector {
  readonly channel: SubmissionChannel;
  submit(pkg: SubmissionPackage): Promise<SubmissionReceipt>;
  /** Optional: poll portal/API for status when no inbound email arrives. */
  pollStatus?(externalRef: string): Promise<{ status: string; raw: unknown }>;
}

// --- E-sign ---------------------------------------------------------------

export interface ESignRequest {
  title: string;
  document: Attachment;
  signers: { name: string; email: string; role: string }[];
  /** Fields the CRM pre-fills (merchant name, EIN last 4, etc.) */
  prefill?: Record<string, string>;
  callbackUrl: string;
}

export interface ESignEnvelope {
  provider: string;
  envelopeId: string;
  status: "SENT" | "VIEWED" | "SIGNED" | "COUNTERSIGNED" | "VOIDED";
  signingUrl?: string;
}

export interface ESignProvider {
  readonly name: string;
  send(req: ESignRequest): Promise<ESignEnvelope>;
  getStatus(envelopeId: string): Promise<ESignEnvelope>;
  downloadSigned(envelopeId: string): Promise<Attachment>;
  /** Verify + parse a webhook payload; returns null if the signature is invalid. */
  parseWebhook(headers: Record<string, string>, body: string): ESignEnvelope | null;
}

// --- Bank link ------------------------------------------------------------

export interface BankLinkSession {
  provider: string;
  linkToken: string;
  expiresAt: Date;
}

export interface BankTransaction {
  date: string; // YYYY-MM-DD
  amount: number; // positive = credit
  description: string;
  pending: boolean;
}

export interface BankLinkProvider {
  readonly name: string;
  createLinkSession(merchantId: string, redirectUri: string): Promise<BankLinkSession>;
  exchangePublicToken(publicToken: string): Promise<{ accessToken: string; accountIds: string[] }>;
  fetchTransactions(accessToken: string, from: string, to: string): Promise<BankTransaction[]>;
  fetchStatementsPdf?(accessToken: string, months: number): Promise<Attachment[]>;
}

// --- Telephony / SMS ------------------------------------------------------

export interface OutboundSms {
  to: string; // E.164
  body: string;
  /** Lead/deal reference for threading */
  correlationId: string;
}

export interface OutboundCall {
  to: string;
  from: string;
  recordingAnnouncement: boolean;
  correlationId: string;
}

export interface TelephonyProvider {
  readonly name: string;
  sendSms(msg: OutboundSms): Promise<{ externalId: string }>;
  startCall(call: OutboundCall): Promise<{ externalId: string }>;
  parseInboundWebhook(
    headers: Record<string, string>,
    body: string,
  ): { kind: "sms" | "call" | "recording"; payload: unknown } | null;
}

// --- Email ----------------------------------------------------------------

export interface OutboundEmail {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Attachment[];
  threadId?: string;
  correlationId: string;
}

export interface InboundEmail {
  externalId: string;
  threadId: string | null;
  from: string;
  to: string[];
  subject: string;
  text: string;
  receivedAt: Date;
  attachments: Attachment[];
}

export interface EmailProvider {
  readonly name: string;
  send(msg: OutboundEmail): Promise<{ externalId: string; threadId: string }>;
  /** Pull messages since a cursor; the worker runs this on a schedule per mailbox. */
  sync(cursor: string | null): Promise<{ messages: InboundEmail[]; nextCursor: string }>;
}

// --- Compliance data ------------------------------------------------------

export interface DncScrubResult {
  phone: string;
  onFederalDnc: boolean;
  onStateDnc: boolean;
  knownLitigator: boolean;
  checkedAt: Date;
}

export interface DncProvider {
  readonly name: string;
  scrub(phones: string[]): Promise<DncScrubResult[]>;
}
