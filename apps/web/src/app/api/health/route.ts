import { apiKeyEnvVar, currentProvider, MODELS } from "@mca/ai";
import { getPrisma } from "@mca/db";

export const dynamic = "force-dynamic";

/** Configuration check for setup. Reports only presence of settings, never their values. */
export async function GET() {
  const checks: Record<string, "ok" | string> = {};
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (err) {
    checks.database = err instanceof Error ? err.message.split("\n")[0]! : String(err);
  }
  const provider = currentProvider();
  const present = (name: string) => (process.env[name] ? "ok" : "missing");
  checks.aiKey = present(apiKeyEnvVar(provider));
  checks.cloudflareAccess =
    process.env.CF_ACCESS_TEAM_DOMAIN && process.env.CF_ACCESS_AUD ? "ok" : "missing";
  checks.googleOAuth =
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "ok" : "missing";
  checks.encryptionKey = present("PII_ENCRYPTION_KEY");
  checks.cronSecret = present("CRON_SECRET");
  const healthy = Object.values(checks).every((v) => v === "ok");
  // WhatsApp is optional: reported for setup, never makes the CRM "degraded".
  const whatsapp = Object.fromEntries(
    [
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_TOKEN",
      "WHATSAPP_APP_SECRET",
      "WHATSAPP_VERIFY_TOKEN",
      "WHATSAPP_BUSINESS_ACCOUNT_ID",
      "APP_URL",
    ].map((name) => [name, present(name)]),
  );
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      ai: { provider, primary: MODELS.primary, fast: MODELS.fast },
      emailDryRun: process.env.MCA_EMAIL_DRY_RUN !== "false",
      checks,
      whatsapp: { ...whatsapp, sending: process.env.WHATSAPP_ENABLED === "true" },
    },
    { status: healthy ? 200 : 503 },
  );
}
