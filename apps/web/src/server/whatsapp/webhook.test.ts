import { createHmac } from "node:crypto";
import { getPrisma, purgeTenant, type PrismaClient } from "@mca/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseReady } from "../testDb";

vi.mock("next/server", () => ({ after: vi.fn() }));
process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
process.env.WHATSAPP_APP_SECRET = "app-secret";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
const { GET, POST } = await import("@/app/api/whatsapp/webhook/route");

const url = "https://crm.example.test/api/whatsapp/webhook";
const signed = (body: string, secret = "app-secret") =>
  new Request(url, {
    method: "POST",
    body,
    headers: {
      "x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
    },
  });
const payload = (id: string, phoneNumberId = "123") =>
  JSON.stringify({
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId },
              messages: [{ from: "13055550777", id, type: "text", text: { body: "Hi" } }],
            },
          },
        ],
      },
    ],
  });

describe("WhatsApp webhook", () => {
  it("answers Meta's verification only with the right token", async () => {
    const ok = await GET(
      new Request(`${url}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42`),
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");
    const bad = await GET(
      new Request(`${url}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`),
    );
    expect(bad.status).toBe(403);
  });

  it("rejects posts without Meta's signature", async () => {
    expect((await POST(signed(payload("x"), "wrong"))).status).toBe(401);
    expect((await POST(new Request(url, { method: "POST", body: payload("x") }))).status).toBe(401);
  });
});

describe.runIf(await databaseReady())("WhatsApp webhook (Postgres)", () => {
  let prisma: PrismaClient;
  let tenantId: string;
  const slug = `wa-hook-${Date.now()}`;

  beforeAll(async () => {
    prisma = getPrisma();
    tenantId = (await prisma.tenant.create({ data: { name: "Hook", slug, teamCc: [] } })).id;
    process.env.TENANT_SLUG = slug;
  });
  afterAll(async () => {
    delete process.env.TENANT_SLUG;
    if (tenantId) await purgeTenant(prisma, tenantId);
  });

  it("stores each message once, only for Ascend's number, and queues the chat", async () => {
    const id = `wamid.hook.${Date.now()}`;
    expect((await POST(signed(payload(id)))).status).toBe(200);
    expect((await POST(signed(payload(id)))).status).toBe(200); // Meta retry
    expect((await POST(signed(payload(`${id}.other`, "999")))).status).toBe(200);
    expect(await prisma.whatsAppMessage.count({ where: { tenantId } })).toBe(1);
    const conv = await prisma.whatsAppConversation.findFirstOrThrow({ where: { tenantId } });
    expect(conv).toMatchObject({ phone: "13055550777", status: "ACTIVE", step: "lang" });
    expect(
      await prisma.job.count({ where: { tenantId, type: "WHATSAPP_MESSAGE", status: "QUEUED" } }),
    ).toBe(1);
  });
});
