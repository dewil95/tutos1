/** Server-only environment access with clear errors (Cloudflare → Workers → ascend-crm → Settings → Variables). */

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/**
 * Lender emails are only really sent when MCA_EMAIL_DRY_RUN is explicitly "false". Anything else
 * (unset in dev, preview deploys) writes the composed message to the deal timeline instead.
 */
export function emailDryRun(): boolean {
  return process.env.MCA_EMAIL_DRY_RUN !== "false";
}

export function allowedEmailDomain(): string {
  return (process.env.ALLOWED_EMAIL_DOMAIN ?? "ascendfund.co").toLowerCase();
}

export function appUrl(req: Request): string {
  return process.env.APP_URL ?? new URL(req.url).origin;
}

export function googleOAuthConfig(req: Request) {
  return {
    clientId: requireEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? `${appUrl(req)}/api/google/callback`,
  };
}

/**
 * Time for jobs run right after a click or an incoming request. On Cloudflare that work runs in
 * `ctx.waitUntil`, which may continue about 30 s after the response, so the default is 25 s;
 * slow AI jobs (40 s+) are left for the scheduled run.
 */
export function inlineBudgetMs(): number {
  return Number(process.env.INLINE_BUDGET_MS ?? 25_000);
}

/** Time for one scheduled run (Cloudflare Cron Trigger every 2 minutes). */
export function tickBudgetMs(): number {
  return Number(process.env.TICK_BUDGET_MS ?? 45_000);
}
