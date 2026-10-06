import { enqueueJob, getPrisma } from "@mca/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { emailDryRun } from "@/server/env";
import { runDueJobs } from "@/server/jobs/runner";
import { ApiKeyCreator } from "./ApiKeyCreator";
import { EmailRulesSection } from "./EmailRulesSection";
import { revokeApiKey } from "./apiKeyActions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  state_mismatch: "The Google sign-in expired. Try again.",
  wrong_account: "Connect a mailbox on the company domain (funding@…).",
  missing_permissions: "Allow both Gmail and Google Drive access on the Google screen.",
  no_refresh_token:
    "Google did not return offline access. Remove the app from the account's Google permissions and connect again.",
  access_denied: "Access was not granted.",
};

async function checkInboxNow() {
  "use server";
  const user = await requireUser();
  const prisma = getPrisma();
  const mailboxes = await prisma.mailboxConnection.findMany({ where: { tenantId: user.tenantId } });
  const ids: string[] = [];
  for (const m of mailboxes) {
    ids.push(
      await enqueueJob(prisma, {
        tenantId: user.tenantId,
        type: "INBOX_SYNC",
        payload: { mailboxId: m.id },
        dedupeKey: `sync:${m.id}`,
      }),
    );
  }
  // Sync first, then any reply parsing it queued.
  after(async () => {
    await runDueJobs(prisma, { budgetMs: 35_000, ids });
    await runDueJobs(prisma, { budgetMs: 20_000, types: ["PARSE_REPLY"] });
  });
  redirect("/settings?checking=1");
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const flash = await searchParams;
  const prisma = getPrisma();
  const [tenant, mailboxes, funders, failedJobs, apiKeys] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
    prisma.mailboxConnection.findMany({ where: { tenantId: user.tenantId } }),
    prisma.funder.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: "asc" } }),
    prisma.job.findMany({
      where: { tenantId: user.tenantId, status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    prisma.apiKey.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: "desc" } }),
  ]);
  const isAdmin = user.role === "ADMIN" || user.role === "MANAGER";

  return (
    <>
      <h1>Settings</h1>
      {flash.error ? <p className="notice error">{ERRORS[flash.error] ?? flash.error}</p> : null}
      {flash.connected ? (
        <p className="notice ok">Connected {flash.connected}. First inbox check is queued.</p>
      ) : null}
      {flash.checking ? (
        <p className="notice ok">Checking the inbox now. Refresh in a minute.</p>
      ) : null}

      <section className="panel">
        <h2>Funding mailbox (Gmail + Google Drive)</h2>
        <p className="small muted">
          Sends from {tenant.fromAddress ?? "—"} · team CC on every submission:{" "}
          {tenant.teamCc.join(", ") || "none"} ·{" "}
          {emailDryRun() ? <strong>dry-run mode (nothing is emailed)</strong> : "live sending"}
        </p>
        {mailboxes.length === 0 ? <p className="empty">Not connected.</p> : null}
        <ul>
          {mailboxes.map((m) => (
            <li key={m.id}>
              {m.email} — last inbox check{" "}
              {m.lastSyncedAt ? m.lastSyncedAt.toLocaleString("en-US") : "never"}
            </li>
          ))}
        </ul>
        <p className="row">
          {isAdmin ? (
            <a className="button" href="/api/google/connect">
              {mailboxes.length ? "Reconnect" : "Connect"} {tenant.fromAddress ?? "mailbox"}
            </a>
          ) : (
            <span className="small muted">An admin connects the mailbox.</span>
          )}
          {mailboxes.length ? (
            <form action={checkInboxNow}>
              <button type="submit">Check inbox now</button>
            </form>
          ) : null}
        </p>
      </section>

      <section className="panel">
        <h2>Website API</h2>
        <p className="small muted">
          Your website sends each completed application to <code>POST /api/v1/applications</code>{" "}
          with an API key (see docs/API.md). The deal, merchant, owners and files appear here
          automatically.
        </p>
        {apiKeys.length ? (
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {apiKeys.map((k) => (
                <tr key={k.id} className={k.revokedAt ? "muted" : ""}>
                  <td>{k.name}</td>
                  <td className="small">
                    <code>{k.prefix}…</code>
                  </td>
                  <td className="small">
                    {k.revokedAt
                      ? `revoked ${k.revokedAt.toLocaleDateString("en-US")}`
                      : k.lastUsedAt
                        ? k.lastUsedAt.toLocaleString("en-US")
                        : "never"}
                  </td>
                  <td>
                    {!k.revokedAt && isAdmin ? (
                      <form action={revokeApiKey}>
                        <input type="hidden" name="id" value={k.id} />
                        <button type="submit">Revoke</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {isAdmin ? <ApiKeyCreator /> : <p className="small muted">An admin creates API keys.</p>}
      </section>

      <EmailRulesSection tenantId={user.tenantId} canEdit={isAdmin} />

      <section className="panel">
        <h2>Lenders ({funders.filter((f) => f.isActive).length} active)</h2>
        <table className="grid">
          <thead>
            <tr>
              <th>Lender</th>
              <th>To</th>
              <th>CC</th>
              <th>Reply domains</th>
            </tr>
          </thead>
          <tbody>
            {funders.map((f) => (
              <tr key={f.id} className={f.isActive ? "" : "muted"}>
                <td>
                  {f.name}
                  {f.isActive ? "" : " (inactive)"}
                </td>
                <td className="small">{f.submissionTo ?? "—"}</td>
                <td className="small">{f.submissionCc.join(", ") || "—"}</td>
                <td className="small">{f.emailDomains.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          Lender addresses come from docs/funder-appetite-matrix.csv (<code>pnpm db:seed</code>).
        </p>
      </section>

      {failedJobs.length ? (
        <section className="panel">
          <h2>Recent failures</h2>
          <ul className="small">
            {failedJobs.map((j) => (
              <li key={j.id}>
                {j.type} · {j.updatedAt.toLocaleString("en-US")} · {j.lastError}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
