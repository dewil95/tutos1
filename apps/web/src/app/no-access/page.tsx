import { getPrisma } from "@mca/db";
import { redirect } from "next/navigation";
import { SIGN_OUT_URL } from "@/server/auth";
import { allowedEmailDomain } from "@/server/env";

export const dynamic = "force-dynamic";

/** Signed in with Google through Cloudflare Access, but not on the team list. */
export default async function NoAccessPage() {
  // Brand-new database: send the first person to the one-time setup instead.
  if ((await getPrisma().tenant.count()) === 0) redirect("/setup");
  return (
    <div className="login-page">
      <section className="login">
        <span className="brand">
          <span className="brand-mark">A</span>
          <span className="brand-name">Ascend CRM</span>
        </span>
        <h1>No access yet</h1>
        <p className="muted" style={{ margin: 0 }}>
          Your Google account is signed in but isn&apos;t on the Ascend team list. Use your @
          {allowedEmailDomain()} account, or ask an admin to add you in Settings.
        </p>
        <a className="button primary" href={SIGN_OUT_URL}>
          Sign in with another account
        </a>
      </section>
    </div>
  );
}
