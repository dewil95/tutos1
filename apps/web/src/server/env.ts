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

/**
 * Emails to merchants (missing documents, stip chases, signing links) are only sent when
 * MERCHANT_EMAILS is explicitly "on", on top of live sending. Otherwise they are written to the
 * deal timeline only, so turning lender emails on never emails a merchant.
 */
export function merchantEmailsOff(): boolean {
  return emailDryRun() || process.env.MERCHANT_EMAILS !== "on";
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
 * Time for jobs run right after a click or an incoming request (in the background of that
 * request on the server); anything unfinished is picked up by the next scheduled run.
 */
export function inlineBudgetMs(): number {
  return Number(process.env.INLINE_BUDGET_MS ?? 60_000);
}

/** Time for one scheduled run (the server's timer calls the tick every 2 minutes). */
export function tickBudgetMs(): number {
  return Number(process.env.TICK_BUDGET_MS ?? 100_000);
}
