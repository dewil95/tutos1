import { getPrisma } from "@mca/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, "ok" | string> = {};
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (err) {
    checks.database = err instanceof Error ? err.message : String(err);
  }
  checks.anthropicKey = process.env.ANTHROPIC_API_KEY ? "ok" : "missing";
  const healthy = Object.values(checks).every((v) => v === "ok");
  return Response.json(
    { status: healthy ? "ok" : "degraded", checks },
    { status: healthy ? 200 : 503 },
  );
}
