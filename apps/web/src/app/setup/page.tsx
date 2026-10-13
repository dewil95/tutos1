import { getPrisma, seedTenant } from "@mca/db";
import { redirect } from "next/navigation";
import { currentIdentity, isAllowedEmail } from "@/server/auth";

export const dynamic = "force-dynamic";

/**
 * First run only: creates Ascend Fund, the team and the lender list in the empty database.
 * Open to the first person Cloudflare Access lets in with an @ascendfund.co account; once a
 * company exists this page just goes home.
 */
async function runSetup() {
  "use server";
  const prisma = getPrisma();
  if (await prisma.tenant.count()) redirect("/");
  const id = await currentIdentity();
  if (!id || !isAllowedEmail(id.email)) redirect("/no-access");
  const { tenant } = await seedTenant(prisma, { slug: process.env.TENANT_SLUG ?? "ascend" });
  // Whoever runs setup can always get in, even if not on the default team list.
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: id.email } },
    update: { role: "ADMIN", isActive: true },
    create: { tenantId: tenant.id, email: id.email, name: id.email.split("@")[0]!, role: "ADMIN" },
  });
  redirect("/settings?setup=done");
}

export default async function SetupPage() {
  const prisma = getPrisma();
  if (await prisma.tenant.count()) redirect("/");
  const id = await currentIdentity();
  return (
    <div className="login-page">
      <section className="login">
        <span className="brand">
          <span className="brand-mark">A</span>
          <span className="brand-name">Ascend CRM</span>
        </span>
        <h1>First-time setup</h1>
        <p className="muted" style={{ margin: 0 }}>
          Creates Ascend Fund, the team (Jonas, Savvy, David) and the lender list in the new
          database. It runs once.
        </p>
        {id && isAllowedEmail(id.email) ? (
          <form action={runSetup}>
            <button className="button primary" type="submit">
              Set up as {id.email}
            </button>
          </form>
        ) : (
          <p className="notice error">Sign in with your company Google account to run setup.</p>
        )}
      </section>
    </div>
  );
}
