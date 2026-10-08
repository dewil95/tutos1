import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createWhatsAppClient,
  parseWhatsAppWebhook,
  verifyWhatsAppSignature,
  WhatsAppApiError,
} from "./cloudApi";

function fakeFetch(responses: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(responses).find((k) => url.includes(k));
    const body = key ? responses[key] : { error: { message: "nope" } };
    if (body instanceof Buffer) return new Response(new Uint8Array(body));
    return new Response(JSON.stringify(body), { status: key ? 200 : 400 });
  };
  return { f, calls };
}

describe("WhatsApp client", () => {
  it("sends text and reply buttons to the phone number's messages endpoint", async () => {
    const { f, calls } = fakeFetch({ "/123/messages": { messages: [{ id: "wamid.1" }] } });
    const wa = createWhatsAppClient({ token: "t", phoneNumberId: "123", fetch: f });
    expect(await wa.sendText("13055550123", "Hi")).toEqual({ messageId: "wamid.1" });
    await wa.sendButtons("13055550123", "Looks right?", [
      { id: "ok", title: "Looks good" },
      { id: "fix", title: "Fix something that is long" },
    ]);
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v23.0/123/messages");
    expect(calls[0]!.init!.headers).toMatchObject({ Authorization: "Bearer t" });
    const btn = JSON.parse(String(calls[1]!.init!.body));
    expect(btn.messaging_product).toBe("whatsapp");
    expect(btn.interactive.action.buttons[1].reply.title.length).toBeLessThanOrEqual(20);
  });

  it("uploads a document before sending it", async () => {
    const { f, calls } = fakeFetch({
      "/123/media": { id: "media-9" },
      "/123/messages": { messages: [{ id: "wamid.2" }] },
    });
    const wa = createWhatsAppClient({ token: "t", phoneNumberId: "123", fetch: f });
    await wa.sendDocument(
      "1305",
      { fileName: "app.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF") },
      "Your copy",
    );
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["media", "messages"]);
    expect(JSON.parse(String(calls[1]!.init!.body)).document).toEqual({
      id: "media-9",
      filename: "app.pdf",
      caption: "Your copy",
    });
  });

  it("downloads media in two steps with the token", async () => {
    const { f, calls } = fakeFetch({
      "/v23.0/m1": { url: "https://lookaside.example/m1", mime_type: "application/pdf" },
      "lookaside.example": Buffer.from("%PDF-1.7"),
    });
    const wa = createWhatsAppClient({ token: "t", phoneNumberId: "123", fetch: f });
    const got = await wa.downloadMedia("m1");
    expect(got.mimeType).toBe("application/pdf");
    expect(got.data.toString()).toBe("%PDF-1.7");
    expect(calls[1]!.init!.headers).toMatchObject({ Authorization: "Bearer t" });
  });

  it("turns API errors into WhatsAppApiError with Meta's message", async () => {
    const { f } = fakeFetch({});
    const wa = createWhatsAppClient({ token: "t", phoneNumberId: "123", fetch: f });
    await expect(wa.sendText("1", "x")).rejects.toThrow(WhatsAppApiError);
    await expect(wa.sendText("1", "x")).rejects.toThrow(/nope/);
  });
});

describe("verifyWhatsAppSignature", () => {
  const body = '{"entry":[]}';
  const sig = "sha256=" + createHmac("sha256", "secret").update(body).digest("hex");
  it("accepts Meta's HMAC and rejects anything else", () => {
    expect(verifyWhatsAppSignature(body, sig, "secret")).toBe(true);
    expect(verifyWhatsAppSignature(body + " ", sig, "secret")).toBe(false);
    expect(verifyWhatsAppSignature(body, sig, "other")).toBe(false);
    expect(verifyWhatsAppSignature(body, null, "secret")).toBe(false);
    expect(verifyWhatsAppSignature(body, "sha256=zz", "secret")).toBe(false);
    expect(verifyWhatsAppSignature(body, sig, "")).toBe(false);
  });
});

describe("parseWhatsAppWebhook", () => {
  it("reads text, button replies, documents and images; skips status updates", () => {
    const msgs = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "123" },
                contacts: [{ wa_id: "13055550123", profile: { name: "Maria" } }],
                messages: [
                  {
                    from: "13055550123",
                    id: "a",
                    timestamp: "1760000000",
                    type: "text",
                    text: { body: "Hola" },
                  },
                  {
                    from: "13055550123",
                    id: "b",
                    type: "interactive",
                    interactive: {
                      type: "button_reply",
                      button_reply: { id: "sign", title: "I agree, sign" },
                    },
                  },
                  {
                    from: "13055550123",
                    id: "c",
                    type: "document",
                    document: { id: "m1", mime_type: "application/pdf", filename: "app.pdf" },
                  },
                  {
                    from: "13055550123",
                    id: "d",
                    type: "image",
                    image: { id: "m2", mime_type: "image/jpeg" },
                  },
                  { from: "13055550123", id: "e", type: "sticker" },
                ],
              },
            },
            { field: "messages", value: { statuses: [{ id: "x", status: "read" }] } },
          ],
        },
      ],
    });
    expect(msgs.map((m) => m.kind)).toEqual(["text", "button", "document", "image", "other"]);
    expect(msgs[0]).toMatchObject({
      from: "13055550123",
      profileName: "Maria",
      text: "Hola",
      phoneNumberId: "123",
    });
    expect(msgs[0]!.timestamp.toISOString()).toBe("2025-10-09T08:53:20.000Z");
    expect(msgs[1]!.buttonId).toBe("sign");
    expect(msgs[2]).toMatchObject({ mediaId: "m1", fileName: "app.pdf" });
    expect(parseWhatsAppWebhook({})).toEqual([]);
  });
});
