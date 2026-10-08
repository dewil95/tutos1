import { parseWhatsAppWebhook, verifyWhatsAppSignature } from "@mca/connectors";
import { getPrisma } from "@mca/db";
import { after } from "next/server";
import { receiveWhatsApp, runChatNow } from "@/server/whatsapp/chat";
import { whatsappSettings, whatsappTenantId } from "@/server/whatsapp/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Meta's one-time check when the webhook URL is saved in the app dashboard. */
export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const { verifyToken } = whatsappSettings();
  if (
    verifyToken &&
    q.get("hub.mode") === "subscribe" &&
    q.get("hub.verify_token") === verifyToken
  ) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

/**
 * Messages from merchants. Checks Meta's signature, stores each message once and answers 200
 * right away (Meta retries slow webhooks); the chat runs as a job right after the response.
 */
export async function POST(req: Request) {
  const s = whatsappSettings();
  const raw = await req.text();
  if (!verifyWhatsAppSignature(raw, req.headers.get("x-hub-signature-256"), s.appSecret)) {
    return new Response("bad signature", { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const msgs = parseWhatsAppWebhook(body).filter(
    (m) => !s.phoneNumberId || m.phoneNumberId === s.phoneNumberId,
  );
  if (msgs.length === 0) return new Response("ok");

  const prisma = getPrisma();
  const tenantId = await whatsappTenantId(prisma);
  if (!tenantId) {
    console.error("[whatsapp] no tenant: set TENANT_SLUG");
    return new Response("ok"); // 200 so Meta does not retry a configuration problem forever
  }
  const ids = await receiveWhatsApp(prisma, tenantId, msgs);
  if (ids.length) after(() => runChatNow(prisma, ids));
  return new Response("ok");
}
