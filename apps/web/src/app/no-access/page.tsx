import { getPrisma } from "@mca/db";
import { redirect } from "next/navigation";
import { currentIdentity, signOutUrl } from "@/server/auth";
import { allowedEmailDomain } from "@/server/env";

export const dynamic = "force-dynamic";

/** Signed in with Google through Cloudflare Access, but not on the team list. */
export default async function NoAccessPage() {
  // Brand-new database: send the first person to the one-time setup instead.
  if ((await getPrisma().tenant.count()) === 0) redirect("/setup");
  // Which account Google signed in: the usual cause is the wrong one of several.
  const email = (await currentIdentity())?.email ?? null;
  return (
    <div className="login-page">
      <section className="login">
        <span className="brand">
          <span className="brand-mark">A</span>
          <span className="brand-name">Ascend CRM</span>
        </span>
        <h1>No access yet</h1>
        <p className="muted" style={{ margin: 0 }}>
          {email ? (
            <>
              You are signed in as <strong>{email}</strong>, which isn&apos;t on the Ascend team
              list.
            </>
          ) : (
            <>Your Google account is signed in but isn&apos;t on the Ascend team list.</>
          )}{" "}
          Use your @{allowedEmailDomain()} account that is on the list, or ask an admin to add this
          one in Settings → Team.
        </p>
        <a className="button primary" href={signOutUrl()}>
          Sign in with another account
        </a>
      </section>
    </div>
  );
}
