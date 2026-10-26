import { getPrisma } from "@mca/db";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { allowedEmailDomain } from "@/server/env";
import { googleSignInEnabled, safeReturnPath } from "@/server/session";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  wrong_account: "That Google account isn't a company account.",
  expired: "The sign-in took too long or was started in another tab. Try again.",
  cancelled: "Sign-in was cancelled.",
  google: "Google couldn't confirm the sign-in. Try again.",
  not_configured: "Sign-in isn't set up on the server yet (SESSION_SECRET is missing).",
};

/** "Sign in with Google" (only when the CRM runs without Cloudflare Access). */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; signed_out?: string }>;
}) {
  const params = await searchParams;
  // Brand-new database: the one-time setup page has its own sign-in button.
  if ((await getPrisma().tenant.count()) === 0) redirect("/setup");
  if (await currentUser().catch(() => null)) redirect(safeReturnPath(params.next));
  const error = params.error ? (ERRORS[params.error] ?? ERRORS.google) : null;
  const next = encodeURIComponent(safeReturnPath(params.next));
  return (
    <div className="login-page">
      <section className="login">
        <span className="brand">
          <span className="brand-mark">A</span>
          <span className="brand-name">Ascend CRM</span>
        </span>
        <h1>Sign in</h1>
        {params.signed_out && !error ? (
          <p className="muted" style={{ margin: 0 }}>
            You&apos;re signed out.
          </p>
        ) : null}
        {error ? <p className="notice error">{error}</p> : null}
        {googleSignInEnabled() ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Use your @{allowedEmailDomain()} Google account.
            </p>
            <a className="button primary" href={`/api/auth/login?next=${next}`}>
              Sign in with Google
            </a>
          </>
        ) : null}
      </section>
    </div>
  );
}
