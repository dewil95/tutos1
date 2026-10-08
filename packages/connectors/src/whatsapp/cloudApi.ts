import { createHmac, timingSafeEqual } from "node:crypto";
import type { FetchLike } from "../google/auth";

/**
 * Meta WhatsApp Cloud API (Meta hosts it; no BSP fee). Used only for merchants who message the
 * Ascend number to apply: replies inside the 24-hour window the merchant opens are free.
 * Plain fetch, like the Google connectors.
 */
export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  /** Graph API version, e.g. "v23.0" (WHATSAPP_GRAPH_VERSION). */
  graphVersion?: string;
  fetch?: FetchLike;
}

export interface WhatsAppButton {
  id: string;
  /** Max 20 characters (WhatsApp limit). */
  title: string;
}

export interface WhatsAppFile {
  fileName: string;
  mimeType: string;
  data: Buffer;
}

export interface WhatsAppClient {
  sendText(to: string, body: string): Promise<{ messageId: string }>;
  sendButtons(to: string, body: string, buttons: WhatsAppButton[]): Promise<{ messageId: string }>;
  sendDocument(to: string, file: WhatsAppFile, caption?: string): Promise<{ messageId: string }>;
  downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }>;
}

export class WhatsAppApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

export function createWhatsAppClient(cfg: WhatsAppConfig): WhatsAppClient {
  const f = cfg.fetch ?? fetch;
  const base = `https://graph.facebook.com/${cfg.graphVersion ?? "v23.0"}`;
  const auth = { Authorization: `Bearer ${cfg.token}` };

  const check = async (res: Response, what: string) => {
    if (res.ok) return;
    let detail = "";
    try {
      const j = (await res.json()) as { error?: { message?: string; code?: number } };
      detail = j.error?.message ? `: ${j.error.message}` : "";
    } catch {
      /* body was not JSON */
    }
    throw new WhatsAppApiError(res.status, `WhatsApp ${what} failed (${res.status})${detail}`);
  };

  const post = async (payload: Record<string, unknown>) => {
    const res = await f(`${base}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...payload,
      }),
    });
    await check(res, "send");
    const j = (await res.json()) as { messages?: { id: string }[] };
    const id = j.messages?.[0]?.id;
    if (!id) throw new WhatsAppApiError(502, "WhatsApp send returned no message id");
    return { messageId: id };
  };

  return {
    sendText: (to, body) =>
      post({ to, type: "text", text: { body: clip(body, 4096), preview_url: true } }),

    sendButtons: (to, body, buttons) => {
      if (buttons.length < 1 || buttons.length > 3) throw new Error("WhatsApp allows 1-3 buttons");
      return post({
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: clip(body, 1024) },
          action: {
            buttons: buttons.map((b) => ({
              type: "reply",
              reply: { id: b.id, title: clip(b.title, 20) },
            })),
          },
        },
      });
    },

    sendDocument: async (to, file, caption) => {
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", file.mimeType);
      form.append(
        "file",
        new Blob([new Uint8Array(file.data)], { type: file.mimeType }),
        file.fileName,
      );
      const up = await f(`${base}/${cfg.phoneNumberId}/media`, {
        method: "POST",
        headers: auth,
        body: form,
      });
      await check(up, "media upload");
      const { id } = (await up.json()) as { id: string };
      return post({
        to,
        type: "document",
        document: {
          id,
          filename: file.fileName,
          ...(caption ? { caption: clip(caption, 1024) } : {}),
        },
      });
    },

    downloadMedia: async (mediaId) => {
      // Two steps: the media id gives a short-lived URL, which needs the same token.
      const meta = await f(`${base}/${encodeURIComponent(mediaId)}`, { headers: auth });
      await check(meta, "media lookup");
      const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string };
      const res = await f(url, { headers: auth });
      await check(res, "media download");
      return { data: Buffer.from(await res.arrayBuffer()), mimeType: mime_type };
    },
  };
}

const clip = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1) + "…");

/** Checks Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the app secret). */
export function verifyWhatsAppSignature(
  rawBody: string | Buffer,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header.slice(7), "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface InboundWhatsApp {
  phoneNumberId: string;
  /** Sender's WhatsApp id: digits with country code. */
  from: string;
  profileName: string | null;
  messageId: string;
  timestamp: Date;
  kind: "text" | "button" | "document" | "image" | "other";
  text: string | null;
  buttonId: string | null;
  mediaId: string | null;
  mimeType: string | null;
  fileName: string | null;
}

interface WebhookMessage {
  from: string;
  id: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  interactive?: { button_reply?: { id: string; title: string } };
  button?: { payload?: string; text?: string };
  document?: { id: string; mime_type?: string; filename?: string; caption?: string };
  image?: { id: string; mime_type?: string; caption?: string };
}

/** Flattens a webhook POST into the messages it carries (status updates are ignored). */
export function parseWhatsAppWebhook(body: unknown): InboundWhatsApp[] {
  const out: InboundWhatsApp[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: { field?: string; value?: unknown }[] }[]) {
    for (const change of entry.changes ?? []) {
      const value = change.value as {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: WebhookMessage[];
      };
      if (!value?.messages) continue;
      const phoneNumberId = value.metadata?.phone_number_id ?? "";
      for (const m of value.messages) {
        const name = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
        const base = {
          phoneNumberId,
          from: m.from,
          profileName: name,
          messageId: m.id,
          timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
          text: null,
          buttonId: null,
          mediaId: null,
          mimeType: null,
          fileName: null,
        };
        if (m.type === "text") out.push({ ...base, kind: "text", text: m.text?.body ?? "" });
        else if (m.type === "interactive" && m.interactive?.button_reply)
          out.push({
            ...base,
            kind: "button",
            text: m.interactive.button_reply.title,
            buttonId: m.interactive.button_reply.id,
          });
        else if (m.type === "button")
          out.push({
            ...base,
            kind: "button",
            text: m.button?.text ?? null,
            buttonId: m.button?.payload ?? null,
          });
        else if (m.type === "document" && m.document)
          out.push({
            ...base,
            kind: "document",
            text: m.document.caption ?? null,
            mediaId: m.document.id,
            mimeType: m.document.mime_type ?? null,
            fileName: m.document.filename ?? null,
          });
        else if (m.type === "image" && m.image)
          out.push({
            ...base,
            kind: "image",
            text: m.image.caption ?? null,
            mediaId: m.image.id,
            mimeType: m.image.mime_type ?? "image/jpeg",
          });
        else out.push({ ...base, kind: "other" });
      }
    }
  }
  return out;
}
