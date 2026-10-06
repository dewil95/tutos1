/**
 * Connector interfaces. Every external system the CRM talks to sits behind one of these so a
 * vendor can be swapped without touching domain code. Ascend Fund works by email only (no
 * dialer, no SMS), files live in Google Drive, and mail goes through Gmail.
 */

export interface Attachment {
  fileName: string;
  mimeType: string;
  data: Buffer;
}

// --- Recipients -----------------------------------------------------------

/**
 * Recipients of one outgoing email. There is deliberately no `bcc` field anywhere in the
 * connectors: each lender gets its own message, so no lender ever sees another lender.
 */
export interface Recipients {
  to: string[];
  cc: string[];
}

// --- Email ----------------------------------------------------------------

export interface OutboundEmail extends Recipients {
  from: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Attachment[];
  /** Gmail thread to reply into (e.g. answering a funder's stip request). */
  threadId?: string;
  /** RFC 5322 Message-ID being replied to; sets In-Reply-To / References. */
  inReplyTo?: string;
  correlationId: string;
}

export interface SentEmail {
  messageId: string;
  threadId: string;
}

export interface InboundAttachmentRef {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  attachmentId: string;
}

export interface InboundEmail {
  messageId: string;
  threadId: string;
  /** RFC 5322 Message-ID header, used for In-Reply-To when answering. */
  rfcMessageId: string | null;
  labelIds: string[];
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  receivedAt: Date;
  attachments: InboundAttachmentRef[];
}

export interface EmailProvider {
  readonly name: string;
  send(msg: OutboundEmail): Promise<SentEmail>;
  /**
   * New messages since `cursor` (null = first run: backfill recent mail). Returns the cursor to
   * store for the next call.
   */
  sync(cursor: string | null): Promise<{ messages: InboundEmail[]; nextCursor: string }>;
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
}

// --- File storage (Google Drive) ------------------------------------------

export interface StoredFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  webViewLink: string | null;
}

export interface StorageProvider {
  readonly name: string;
  /** Creates missing folders along the path and returns the last folder's id. */
  ensureFolderPath(path: string[], rootId?: string): Promise<string>;
  upload(file: Attachment, folderId: string): Promise<StoredFile>;
  download(fileId: string): Promise<Buffer>;
  list(folderId: string): Promise<StoredFile[]>;
  /** Grants read access to specific people (never "anyone with the link"). */
  shareWith(fileId: string, emails: string[]): Promise<void>;
}

// --- Funder submission ----------------------------------------------------

export type SubmissionChannel = "EMAIL" | "PORTAL" | "API";

export interface PositionLine {
  funder: string;
  balance: number | null;
}

export interface SubmissionPackage {
  dealId: string;
  submissionId: string;
  funderName: string;
  merchantName: string;
  /** Existing advances, written as "funder: $balance" lines like the team does today. */
  positions: PositionLine[];
  /** Free text, e.g. "INDUSTRY: RESTAURANT" or why revenue dropped in August. */
  note?: string;
  attachments: Attachment[];
  /** Drive links used instead of attachments when the package is too large to email. */
  links?: { fileName: string; url: string }[];
}

export interface SubmissionReceipt {
  channel: SubmissionChannel;
  externalRef: string;
  messageId?: string;
  sentAt: Date;
}

export interface FunderConnector {
  readonly channel: SubmissionChannel;
  submit(pkg: SubmissionPackage, recipients: Recipients): Promise<SubmissionReceipt>;
}
