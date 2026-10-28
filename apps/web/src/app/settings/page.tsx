import { asList, enqueueJob, getPrisma } from "@mca/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { emailDryRun, inlineBudgetMs } from "@/server/env";
import { runDueJobs } from "@/server/jobs/runner";
import { ApiKeyCreator } from "./ApiKeyCreator";
import { EmailRulesSection } from "./EmailRulesSection";
import { WhatsAppSection } from "./WhatsAppSection";
import { ApplicationSection } from "./ApplicationSection";
import { HistorySection } from "./HistorySection";
import { serverStatus } from "@/server/serverUsage";
import { revokeApiKey } from "./apiKeyActions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  state_mismatch: "The Google sign-in expired. Try again.",
  wrong_account: "Connect a mailbox on the company domain (e.g. jonas@ascendfund.co).",
  missing_permissions: "Allow both Gmail and Google Drive access on the Google screen.",
  no_refresh_token:
    "Google did not return offline access. Remove the app from the account's Google permissions and connect again.",
  access_denied: "Access was not granted.",
  missing_read_permission: "Allow Gmail read access on the Google screen.",
  already_connected:
    "That mailbox is the team mailbox; it can't also be a read-only history mailbox.",
};

/** Who is CC'd on every lender submission (admins only). */
async function saveTeamCc(form: FormData) {
  "use server";
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "MANAGER") redirect("/settings");
  const list = String(form.get("teamCc") ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const bad = list.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad.length) {
    redirect(
      `/settings?${new URLSearchParams({ error: `Not an email address: ${bad.join(", ")}` })}`,
    );
  }
  await getPrisma().tenant.update({
    where: { id: user.tenantId },
    data: { teamCc: [...new Set(list)] },
  });
  redirect("/settings?cc=1");
}

async function checkInboxNow() {
  "use server";
  const user = await requireUser();
  const prisma = getPrisma();
  const mailboxes = await prisma.mailboxConnection.findMany({
    where: { tenantId: user.tenantId, purpose: "send" },
  });
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
    const total = inlineBudgetMs();
    await runDueJobs(prisma, { budgetMs: total * 0.6, ids });
    await runDueJobs(prisma, { budgetMs: total * 0.4, types: ["PARSE_REPLY"] });
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
  const [tenant, allMailboxes, funders, failedJobs, apiKeys] = await Promise.all([
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
  const mailboxes = allMailboxes.filter((m) => m.purpose !== "history");
  const historyMailboxes = allMailboxes.filter((m) => m.purpose === "history");

  return (
    <>
      <h1>Settings</h1>
      {flash.error ? <p className="notice error">{ERRORS[flash.error] ?? flash.error}</p> : null}
      {flash.connected ? (
        <p className="notice ok">
          Connected {flash.connected}.{" "}
          {flash.history ? "Reading its past email now." : "First inbox check is queued."}
        </p>
      ) : null}
      {flash.checking ? (
        <p className="notice ok">Checking the inbox now. Refresh in a minute.</p>
      ) : null}
      {flash.cc ? <p className="notice ok">Team CC saved.</p> : null}

      <ServerStatus />

      <section className="panel">
        <h2>Team mailbox (Gmail + Google Drive)</h2>
        <p className="small muted">
          Sends from {tenant.fromAddress ?? "—"} · team CC on every submission:{" "}
          {asList(tenant.teamCc).join(", ") || "none"} ·{" "}
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
            <>
              <a className="button" href="/api/google/connect">
                {mailboxes.length ? "Reconnect" : "Connect"} the team mailbox
              </a>
              <span className="small muted">
                Pick the Google account to use (e.g. jonas@): the CRM sends from it and stores deal
                files in its Drive.
              </span>
            </>
          ) : (
            <span className="small muted">An admin connects the mailbox.</span>
          )}
          {mailboxes.length ? (
            <form action={checkInboxNow}>
              <button type="submit">Check inbox now</button>
            </form>
          ) : null}
        </p>
        {isAdmin ? (
          <form action={saveTeamCc} className="row">
            <label className="field" style={{ flex: "1 1 420px" }}>
              Team CC on every lender email (comma separated)
              <input
                name="teamCc"
                defaultValue={asList(tenant.teamCc).join(", ")}
                placeholder="xavier@ascendfund.co, david@ascendfund.co"
              />
            </label>
            <button type="submit">Save CC</button>
          </form>
        ) : null}
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

      <HistorySection mailboxes={historyMailboxes} canEdit={isAdmin} />

      <ApplicationSection tenantId={user.tenantId} canEdit={isAdmin} />

      <WhatsAppSection
        tenantId={user.tenantId}
        canEdit={isAdmin}
        flash={{ ok: flash.wa, error: flash.waError }}
      />

      <EmailRulesSection tenantId={user.tenantId} canEdit={isAdmin} />

      <section className="panel">
        <h2>Lenders ({funders.filter((f) => f.isActive).length} active)</h2>
        <div className="tablewrap">
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
                  <td className="small">{asList(f.submissionCc).join(", ") || "—"}</td>
                  <td className="small">{asList(f.emailDomains).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

const RISK_TEXT = {
  low: "low",
  watch: "watch: close to Oracle's 20% line",
  high: "high: Oracle could treat the server as idle",
  unknown: "not measured yet",
} as const;

/** Oracle idle-reclaim risk and the last nightly backup check (from the server's timers). */
function ServerStatus() {
  const { usage, backupCheck } = serverStatus();
  return (
    <section className="panel">
      <h2>Server</h2>
      <p className="small">
        Idle risk:{" "}
        <strong
          className={usage.idleRisk === "high" ? "error" : usage.idleRisk === "watch" ? "warn" : ""}
        >
          {RISK_TEXT[usage.idleRisk]}
        </strong>
        {usage.samples ? (
          <span className="muted">
            {" "}
            · memory {usage.memAvg}% (lowest {usage.memMin}%), CPU {usage.cpuP95}% (95th
            percentile), over {usage.days} days
          </span>
        ) : null}
      </p>
      <p className="small">
        Last backup check:{" "}
        {backupCheck ? (
          <span className={backupCheck.ok ? "ok" : "error"}>
            {backupCheck.ok ? "restored and intact" : "failed"} ·{" "}
            {new Date(backupCheck.at).toLocaleString("en-US")} · {backupCheck.detail}
          </span>
        ) : (
          <span className="muted">none yet (runs every night)</span>
        )}
      </p>
    </section>
  );
}
