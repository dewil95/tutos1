import { afterEach, describe, expect, it, vi } from "vitest";
import { runWhatsAppSetup, setupConfig } from "./setup";

const ENV = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID"];
afterEach(() => {
  for (const k of ENV) delete process.env[k];
  vi.unstubAllEnvs();
});

const fakeFetch = (routes: Record<string, unknown>) =>
  (async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    return new Response(JSON.stringify(key ? routes[key] : { error: { message: "nope" } }), {
      status: key ? 200 : 400,
    });
  }) as never;

describe("WhatsApp setup steps", () => {
  it("names the missing Vercel variables", () => {
    expect(() => setupConfig()).toThrow(
      "Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Vercel",
    );
  });

  it("reports the number, its name review and the webhook subscription in one sentence", async () => {
    const cfg = {
      token: "t",
      phoneNumberId: "123",
      businessAccountId: "999",
      fetch: fakeFetch({
        "/123?fields": {
          display_phone_number: "+1 305-555-0100",
          verified_name: "Ascend Fund",
          name_status: "PENDING_REVIEW",
          code_verification_status: "VERIFIED",
        },
        "/999/subscribed_apps": { data: [] },
      }),
    };
    expect(await runWhatsAppSetup("check", { cfg })).toBe(
      'Connected to +1 305-555-0100, name "Ascend Fund" (pending review), code verified. No app is subscribed to webhooks yet: press Connect webhooks.',
    );
  });

  it("registers and connects webhooks", async () => {
    const cfg = {
      token: "t",
      phoneNumberId: "123",
      businessAccountId: "999",
      fetch: fakeFetch({
        "/123/register": { success: true },
        "/999/subscribed_apps": { success: true },
      }),
    };
    expect(await runWhatsAppSetup("register", { cfg, pin: " 123456 " })).toMatch(/registered/);
    expect(await runWhatsAppSetup("webhooks", { cfg })).toMatch(/Webhooks connected/);
  });
});
