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
  checks.supabaseAuth =
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? "ok"
      : "missing";
  checks.googleOAuth =
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "ok" : "missing";
  checks.encryptionKey = present("PII_ENCRYPTION_KEY");
  checks.cronSecret = present("CRON_SECRET");
  const healthy = Object.values(checks).every((v) => v === "ok");
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      ai: { provider, primary: MODELS.primary, fast: MODELS.fast },
      emailDryRun: process.env.MCA_EMAIL_DRY_RUN !== "false",
      checks,
    },
    { status: healthy ? 200 : 503 },
  );
}
