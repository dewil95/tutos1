import { describe, expect, it, vi } from "vitest";

vi.mock("@mca/db", () => ({ getPrisma: () => ({ $queryRaw: async () => 1 }) }));
const { GET } = await import("./route");

describe("/api/health", () => {
  it("reports WhatsApp settings by presence only and never fails because of them", async () => {
    const keep = { ...process.env };
    Object.assign(process.env, {
      GEMINI_API_KEY: "x",
      NEXT_PUBLIC_SUPABASE_URL: "x",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "x",
      GOOGLE_CLIENT_ID: "x",
      GOOGLE_CLIENT_SECRET: "x",
      PII_ENCRYPTION_KEY: "x",
      CRON_SECRET: "x",
      WHATSAPP_TOKEN: "secret-token-value",
    });
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.MCA_AI_PROVIDER;
    try {
      const res = await GET();
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.whatsapp).toMatchObject({
        WHATSAPP_TOKEN: "ok",
        WHATSAPP_PHONE_NUMBER_ID: "missing",
        sending: false,
      });
      expect(JSON.stringify(body)).not.toContain("secret-token-value");
    } finally {
      process.env = keep;
    }
  });
});
