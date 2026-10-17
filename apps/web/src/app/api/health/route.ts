import { statfsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { apiKeyEnvVar, currentProvider, MODELS } from "@mca/ai";
import { databasePath, getPrisma } from "@mca/db";

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
      server: serverInfo(),
      ai: { provider, primary: MODELS.primary, fast: MODELS.fast },
      emailDryRun: process.env.MCA_EMAIL_DRY_RUN !== "false",
      checks,
      whatsapp: { ...whatsapp, sending: process.env.WHATSAPP_ENABLED === "true" },
    },
    { status: healthy ? 200 : 503 },
  );
}

/** Database size and free disk on the server (a full disk is the usual way a server dies). */
function serverInfo() {
  const mb = (bytes: number) => Math.round(bytes / 1_048_576);
  try {
    const path = databasePath();
    const fs = statfsSync(dirname(path));
    return { databaseMb: mb(statSync(path).size), diskFreeMb: mb(fs.bavail * fs.bsize) };
  } catch {
    return { databaseMb: null, diskFreeMb: null };
  }
}
