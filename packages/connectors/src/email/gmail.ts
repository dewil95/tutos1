import { GoogleApiError, type GoogleAuth } from "../google/auth";
import type {
  EmailProvider,
  InboundAttachmentRef,
  InboundEmail,
  OutboundEmail,
  SentEmail,
} from "../types";
import { buildMime, toBase64Url } from "./mime";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
}

function header(part: GmailPart | undefined, name: string): string | null {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

/** "Name <a@b.com>, c@d.com" → ["a@b.com", "c@d.com"] */
export function parseAddressList(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((s) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

function decode(data: string | undefined): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h\d|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Walks the MIME tree: prefers text/plain, falls back to HTML; collects real attachments. */
export function parseGmailMessage(m: GmailMessage): InboundEmail {
  let plain = "";
  let html = "";
  const attachments: InboundAttachmentRef[] = [];
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      attachments.push({
        fileName: p.filename,
        mimeType: p.mimeType ?? "application/octet-stream",
        sizeBytes: p.body.size ?? 0,
        attachmentId: p.body.attachmentId,
      });
    } else if (p.mimeType === "text/plain" && !plain) plain = decode(p.body?.data);
    else if (p.mimeType === "text/html" && !html) html = decode(p.body?.data);
    p.parts?.forEach(walk);
  };
  walk(m.payload);
  return {
    messageId: m.id,
    threadId: m.threadId,
    rfcMessageId: header(m.payload, "Message-ID"),
    labelIds: m.labelIds ?? [],
    from: parseAddressList(header(m.payload, "From"))[0] ?? "",
    to: parseAddressList(header(m.payload, "To")),
    cc: parseAddressList(header(m.payload, "Cc")),
    subject: header(m.payload, "Subject") ?? "",
    text: plain || htmlToText(html),
    receivedAt: new Date(Number(m.internalDate ?? Date.now())),
    attachments,
  };
}

export interface GmailProviderOptions {
  /** On first sync, how far back to read (Gmail search syntax days). */
  backfillDays?: number;
  maxMessagesPerSync?: number;
}

export class GmailProvider implements EmailProvider {
  readonly name = "gmail";

  constructor(
    private readonly auth: GoogleAuth,
    private readonly opts: GmailProviderOptions = {},
  ) {}

  async send(msg: OutboundEmail): Promise<SentEmail> {
    const raw = toBase64Url(buildMime(msg));
    const res = await this.auth.json<{ id: string; threadId: string }>(`${API}/messages/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(msg.threadId ? { raw, threadId: msg.threadId } : { raw }),
    });
    return { messageId: res.id, threadId: res.threadId };
  }

  async getMessage(id: string): Promise<InboundEmail> {
    return parseGmailMessage(
      await this.auth.json<GmailMessage>(`${API}/messages/${id}?format=full`),
    );
  }

  /** Message ids matching a Gmail search query (e.g. `in:sent to:x subject:"y"`). */
  async search(q: string, maxResults = 10): Promise<string[]> {
    const r = await this.auth.json<{ messages?: { id: string }[] }>(
      `${API}/messages?q=${encodeURIComponent(q)}&maxResults=${maxResults}`,
    );
    return (r.messages ?? []).map((m) => m.id);
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const r = await this.auth.json<{ data: string }>(
      `${API}/messages/${messageId}/attachments/${attachmentId}`,
    );
    return Buffer.from(r.data, "base64url");
  }

  async sync(cursor: string | null): Promise<{ messages: InboundEmail[]; nextCursor: string }> {
    const max = this.opts.maxMessagesPerSync ?? 100;
    if (cursor) {
      try {
        return await this.syncHistory(cursor);
      } catch (err) {
        // historyId older than ~1 week → 404; fall back to a time-window backfill.
        if (!(err instanceof GoogleApiError && err.status === 404)) throw err;
      }
    }
    const profile = await this.auth.json<{ historyId: string }>(`${API}/profile`);
    const q = encodeURIComponent(`newer_than:${this.opts.backfillDays ?? 14}d -in:drafts`);
    const list = await this.auth.json<{ messages?: { id: string }[] }>(
      `${API}/messages?q=${q}&maxResults=${max}`,
    );
    const messages = await this.fetchAll((list.messages ?? []).map((m) => m.id));
    return { messages, nextCursor: profile.historyId };
  }

  private async syncHistory(cursor: string) {
    const ids: string[] = [];
    let pageToken: string | undefined;
    let latest = cursor;
    do {
      const url =
        `${API}/history?startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
      const page = await this.auth.json<{
        history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[];
        historyId?: string;
        nextPageToken?: string;
      }>(url);
      for (const h of page.history ?? [])
        for (const a of h.messagesAdded ?? []) {
          if (a.message.labelIds?.includes("DRAFT")) continue;
          if (!ids.includes(a.message.id)) ids.push(a.message.id);
        }
      if (page.historyId) latest = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken);
    // Never truncate: the cursor already points past every listed message, so anything dropped
    // here would be skipped for good. maxMessagesPerSync only limits the first-run backfill.
    return { messages: await this.fetchAll(ids), nextCursor: latest };
  }

  private async fetchAll(ids: string[]): Promise<InboundEmail[]> {
    const out: InboundEmail[] = [];
    // Small batches keep well inside Gmail's per-user rate limits on a serverless tick.
    for (let i = 0; i < ids.length; i += 10) {
      out.push(...(await Promise.all(ids.slice(i, i + 10).map((id) => this.getMessage(id)))));
    }
    return out.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }
}
