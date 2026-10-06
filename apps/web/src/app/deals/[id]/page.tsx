import type { FunderReply } from "@mca/ai";
import type { PositionLine } from "@mca/connectors";
import { getPrisma, type DocumentType } from "@mca/db";
import type { BankMetrics } from "@mca/domain";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { defaultPackage } from "@/server/documents";
import { emailDryRun } from "@/server/env";
import { positionsToText } from "@/server/submissions";
import { dealProfile, lenderHistory, lenderRows } from "@/server/lenders";
import { SelectTopLenders } from "./SelectTopLenders";
import { MerchantPanel } from "./MerchantPanel";
import { BankScrubPanel } from "./BankScrubPanel";
import { RiskReportPanel } from "./RiskReportPanel";
import { ContractRequestForm } from "./ContractRequestForm";
import {
  analyseDealStatements,
  confirmClawback,
  relabelDocument,
  retrySubmission,
  sendToLenders,
  uploadFiles,
} from "./actions";

export const dynamic = "force-dynamic";
// Server actions on this page run queued jobs right after the click.
export const maxDuration = 60;

const DOC_TYPES: DocumentType[] = [
  "APPLICATION",
  "BANK_STATEMENT",
  "MTD_STATEMENT",
  "VOIDED_CHECK",
  "DRIVERS_LICENSE",
  "TAX_RETURN",
  "CONTRACT",
  "OTHER",
];

const label = (s: string) => s.replace(/_/g, " ").toLowerCase();
const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
const kb = (n: number) =>
  n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;

export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const flash = await searchParams;
  const prisma = getPrisma();

  const deal = await prisma.deal.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      merchant: { include: { owners: { orderBy: { createdAt: "asc" } } } },
      owner: { select: { name: true } },
    },
  });
  if (!deal) notFound();

  const [tenant, allDocuments, submissions, funders, activities, analysis, mailbox] =
    await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
      prisma.document.findMany({
        where: { dealId: id },
        orderBy: [{ type: "asc" }, { createdAt: "desc" }],
      }),
      prisma.submission.findMany({
        where: { deal: { merchantId: deal.merchantId } },
        include: { funder: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.funder.findMany({
        where: { tenantId: user.tenantId, isActive: true },
        include: { programs: { where: { isActive: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.activity.findMany({
        where: { dealId: id },
        orderBy: { occurredAt: "desc" },
        take: 60,
      }),
      prisma.bankAnalysis.findFirst({ where: { dealId: id }, orderBy: { createdAt: "desc" } }),
      prisma.mailboxConnection.findFirst({ where: { tenantId: user.tenantId } }),
    ]);
  const jobs = await prisma.job.findMany({
    where: { dedupeKey: { in: submissions.map((s) => `send:${s.id}`) } },
    select: { dedupeKey: true, status: true, lastError: true, runAt: true },
  });

  // Team-only files (Risk Report) are listed separately and can never be packaged.
  const documents = allDocuments.filter((d) => !d.internalOnly);
  const riskPdf = allDocuments.find(
    (d) =>
      d.internalOnly &&
      d.id === (deal.riskReport as { pdfDocumentId?: string } | null)?.pdfDocumentId,
  );
  const merchantName = deal.merchant.dba ?? deal.merchant.legalName;
  const preselected = new Set(defaultPackage(documents));
  const submittedFunderIds = new Set(
    submissions.filter((s) => s.status !== "WITHDRAWN").map((s) => s.funderId),
  );
  const thisDealSubs = submissions.filter((s) => s.dealId === id);
  const positions = (deal.submissionPositions ?? []) as unknown as PositionLine[];

  const metrics = analysis?.metrics as unknown as BankMetrics | undefined;
  const pendingStatements = documents.filter(
    (d) => d.type === "BANK_STATEMENT" && !d.extractedAt,
  ).length;
  const history = await lenderHistory(prisma, user.tenantId, deal.paperGrade);
  const activePositions = await prisma.position.count({ where: { dealId: id, isActive: true } });
  const rows = lenderRows({
    funders,
    tenant,
    history,
    alreadySubmitted: submittedFunderIds,
    profile: dealProfile({
      paperGrade: deal.paperGrade,
      avgMonthlyTrueRevenue: metrics?.avgMonthlyTrueRevenue ?? null,
      startDate: deal.merchant.startDate,
      // Typed positions or advances the bank scrub saw still debiting, whichever is more.
      existingPositions: Math.max(positions.length, activePositions),
      requestedAmount: deal.requestedAmount ? Number(deal.requestedAmount) : null,
      state: deal.merchant.state,
      naics: deal.merchant.naics,
    }),
  });

  const replyFor = (submissionId: string) =>
    activities
      .filter((a) => a.aiSummary)
      .map((a) => ({ a, r: a.aiSummary as unknown as FunderReply }))
      .find(({ a }) =>
        (
          (thisDealSubs.find((s) => s.id === submissionId)?.rawStatusLog ?? []) as {
            activityId?: string;
          }[]
        ).some((e) => e.activityId === a.id),
      );

  return (
    <>
      <p className="crumbs">
        <a href="/">Deals</a> / {merchantName}
      </p>
      <h1>{merchantName}</h1>
      <p className="meta">
        {label(deal.stage)}
        {deal.paperGrade ? ` · grade ${deal.paperGrade}` : ""}
        {deal.requestedAmount ? ` · requested ${money(Number(deal.requestedAmount))}` : ""}
        {deal.merchant.state ? ` · ${deal.merchant.state}` : ""}
        {deal.owner ? ` · ${deal.owner.name}` : ""}
        {deal.driveFolderId ? (
          <>
            {" · "}
            <a
              href={`https://drive.google.com/drive/folders/${deal.driveFolderId}`}
              target="_blank"
              rel="noreferrer"
            >
              Drive folder
            </a>
          </>
        ) : null}
      </p>

      {flash.error ? <p className="notice error">{flash.error}</p> : null}
      {flash.queued ? (
        <p className="notice ok">
          {flash.queued} lender email(s) queued — one separate email per lender.
          {emailDryRun() ? " Dry-run mode: emails are written to the timeline, not sent." : ""}
        </p>
      ) : null}
      {flash.skipped ? <p className="notice warn">Skipped: {flash.skipped}</p> : null}
      {flash.uploaded ? (
        <p className="notice ok">{flash.uploaded} file(s) saved to Google Drive.</p>
      ) : null}
      {flash.analysing ? (
        <p className="notice ok">Bank scrub started. Refresh in a minute.</p>
      ) : null}
      {flash.sent ? (
        <p className="notice ok">
          {flash.sent}
          {emailDryRun() ? " (dry run: written to the timeline)" : ""}.
        </p>
      ) : null}
      {flash.risk ? (
        <p className="notice ok">Risk report is being regenerated. Refresh in a minute.</p>
      ) : null}
      {!mailbox ? (
        <p className="notice warn">
          Gmail/Drive not connected yet — an admin can connect funding@ in{" "}
          <a href="/settings">Settings</a>.
        </p>
      ) : null}

      <MerchantPanel deal={deal} merchant={deal.merchant} owners={deal.merchant.owners} />

      <section className="panel">
        <h2>Lender status</h2>
        {thisDealSubs.length === 0 ? <p className="empty">Not sent to any lender yet.</p> : null}
        {thisDealSubs.length ? (
          <table className="grid">
            <thead>
              <tr>
                <th>Lender</th>
                <th>Status</th>
                <th>Sent</th>
                <th>To / CC</th>
                <th>Latest reply</th>
              </tr>
            </thead>
            <tbody>
              {thisDealSubs.map((s) => {
                const job = jobs.find((j) => j.dedupeKey === `send:${s.id}`);
                const reply = replyFor(s.id);
                return (
                  <tr key={s.id}>
                    <td>{s.funder.name}</td>
                    <td>
                      <span className={`pill ${s.status.toLowerCase()}`}>{label(s.status)}</span>
                      {s.status === "DRAFT" && job?.status === "FAILED" ? (
                        <form action={retrySubmission.bind(null, id)} className="inline">
                          <input type="hidden" name="submissionId" value={s.id} />
                          <span className="error small">
                            send failed: {job.lastError?.slice(0, 120)}
                          </span>{" "}
                          <button type="submit">Retry</button>
                        </form>
                      ) : s.status === "DRAFT" ? (
                        <span className="small muted"> sending…</span>
                      ) : null}
                      {s.declineReason ? (
                        <div className="small muted">{s.declineReason}</div>
                      ) : null}
                    </td>
                    <td className="small">{s.sentAt ? s.sentAt.toLocaleString("en-US") : "—"}</td>
                    <td className="small">
                      <div>To: {s.toAddresses.join(", ")}</div>
                      {s.ccAddresses.length ? (
                        <div className="muted">CC: {s.ccAddresses.join(", ")}</div>
                      ) : null}
                    </td>
                    <td className="small">
                      {reply ? (
                        <>
                          <div>{reply.r.summary}</div>
                          {reply.r.offers.length ? (
                            <table className="offers">
                              <tbody>
                                {reply.r.offers.map((o, i) => (
                                  <tr key={i}>
                                    <td>{money(o.advanceAmount)}</td>
                                    <td>{o.factorRate}</td>
                                    <td>
                                      {o.paymentAmount
                                        ? `${money(o.paymentAmount)} ${o.paymentFrequency?.toLowerCase() ?? ""}`
                                        : ""}
                                    </td>
                                    <td>
                                      {o.termDays
                                        ? `${o.termDays}d`
                                        : o.numberOfPayments
                                          ? `${o.numberOfPayments} pmts`
                                          : ""}
                                    </td>
                                    <td>
                                      {o.commissionPoints !== null
                                        ? `${o.commissionPoints} pts`
                                        : ""}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : null}
                          {reply.r.offers.length ? (
                            <div className="muted">
                              AI-read offer — check against the email before quoting.
                            </div>
                          ) : null}
                          {reply.r.intent === "FUNDED" &&
                          reply.r.funded.requiresConfirmationReply ? (
                            <form action={confirmClawback.bind(null, id)} className="inline">
                              <input type="hidden" name="submissionId" value={s.id} />
                              <input type="hidden" name="activityId" value={reply.a.id} />
                              <button type="submit">Reply: confirm clawback policy</button>
                            </form>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                      {s.status === "APPROVED" && s.gmailThreadId ? (
                        <ContractRequestForm
                          dealId={id}
                          submissionId={s.id}
                          merchantEmail={deal.merchant.email}
                          offer={reply?.r.offers[0] ?? null}
                          stipFiles={allDocuments
                            .filter(
                              (d) => d.type === "VOIDED_CHECK" || d.type === "DRIVERS_LICENSE",
                            )
                            .map((d) => ({ id: d.id, fileName: d.fileName }))}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </section>

      <form action={sendToLenders.bind(null, id)} className="panel">
        <h2>Ship the file</h2>
        <div className="cols">
          <div>
            <h3>1. Files from Google Drive</h3>
            {documents.length === 0 ? (
              <p className="empty">
                No files yet. Upload below, or have the merchant email them to{" "}
                {tenant.fromAddress ?? "the funding inbox"} — the inbox check files them here
                automatically.
              </p>
            ) : null}
            <ul className="files">
              {documents.map((d) => (
                <li key={d.id}>
                  <label>
                    <input
                      type="checkbox"
                      name="documentIds"
                      value={d.id}
                      defaultChecked={preselected.has(d.id)}
                    />{" "}
                    {d.fileName}
                  </label>{" "}
                  <span className="small muted">
                    {label(d.type)} · {kb(d.sizeBytes)} · via {d.uploadedVia.replace("_", " ")}
                  </span>{" "}
                  {d.driveWebViewLink ? (
                    <a className="small" href={d.driveWebViewLink} target="_blank" rel="noreferrer">
                      open
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>

            <h3>2. Positions and note (email body)</h3>
            <label className="field">
              <span>
                Existing positions, one per line (<code>Lender: $balance</code>)
              </span>
              <textarea name="positions" rows={4} defaultValue={positionsToText(positions)} />
            </label>
            <label className="field">
              Note (optional, e.g. industry or why revenue dipped)
              <textarea name="note" rows={2} defaultValue={deal.submissionNote ?? ""} />
            </label>
          </div>

          <div>
            <h3>3. Lenders — one separate email each</h3>
            <p className="small muted">
              To = the lender&apos;s first address · CC = its other addresses + team (
              {tenant.teamCc.join(", ") || "none"}) · never BCC
            </p>
            <SelectTopLenders />
            <ul className="lenders">
              {rows.map(({ funder: f, to, cc, problem, already, eligible, score, reasons }) => (
                <li
                  key={f.id}
                  className={already || problem ? "disabled" : eligible ? "" : "outside"}
                >
                  <label>
                    <input
                      type="checkbox"
                      name="funderIds"
                      value={f.id}
                      disabled={already || !!problem}
                      data-recommended={!already && !problem && eligible ? "1" : undefined}
                    />{" "}
                    <strong>{f.name}</strong>
                  </label>{" "}
                  {!already && !problem ? (
                    <span className={`score ${eligible ? "fit" : "nofit"}`} title="Fit score 0-100">
                      {eligible ? `fit ${score}` : "outside appetite"}
                    </span>
                  ) : null}
                  {already ? (
                    <span className="small muted"> already submitted for this merchant</span>
                  ) : null}
                  {problem ? <span className="small error"> {problem}</span> : null}
                  {!problem ? (
                    <div className="small muted">
                      To: {to.join(", ")}
                      {cc.length ? ` · CC: ${cc.join(", ")}` : ""}
                    </div>
                  ) : null}
                  {reasons.length && !already ? (
                    <div className={`small ${eligible ? "muted" : "warn"}`}>
                      {reasons.join(" · ")}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p>
          <button type="submit" className="primary">
            Send to selected lenders
          </button>{" "}
          <span className="small muted">
            Subject: &quot;New Deal Submission - {merchantName}&quot;. Packages over 18 MB go as
            Drive links shared only with that lender.
          </span>
        </p>
        <p>
          <button type="submit" formAction={analyseDealStatements.bind(null, id)}>
            Re-run bank scrub on checked statements
          </button>{" "}
          <span className="small muted">
            Statements are scrubbed automatically on arrival; use this after fixing a file.
          </span>
        </p>
      </form>

      <section className="panel">
        <h2>Add files</h2>
        <form action={uploadFiles.bind(null, id)} className="row">
          <input
            type="file"
            name="files"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.heic,.docx,.xlsx,.csv"
          />
          <select name="type" defaultValue="">
            <option value="">Detect from file name</option>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </select>
          <button type="submit">Upload to Drive</button>
        </form>
        <p className="small muted">
          Up to 4 MB per upload. Larger files: email them to the funding inbox.
        </p>
        {documents.length ? (
          <details>
            <summary className="small">Fix a file type</summary>
            {documents.map((d) => (
              <form key={d.id} action={relabelDocument.bind(null, id)} className="row small">
                <input type="hidden" name="documentId" value={d.id} />
                <span>{d.fileName}</span>
                <select name="type" defaultValue={d.type}>
                  {DOC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {label(t)}
                    </option>
                  ))}
                </select>
                <button type="submit">Save</button>
              </form>
            ))}
          </details>
        ) : null}
      </section>

      <BankScrubPanel dealId={id} analysis={analysis} pending={pendingStatements} />

      <RiskReportPanel
        dealId={id}
        report={deal.riskReport}
        pdfLink={riskPdf?.driveWebViewLink ?? null}
        hasScrub={Boolean(analysis?.scrub)}
      />

      <section className="panel">
        <h2>Timeline</h2>
        {activities.length === 0 ? <p className="empty">No emails yet.</p> : null}
        <ul className="timeline">
          {activities.map((a) => (
            <li key={a.id}>
              <span className="small muted">
                {a.occurredAt.toLocaleString("en-US")} · {a.direction.toLowerCase()} ·{" "}
                {a.fromAddress ?? ""}
              </span>
              <div>{a.subject}</div>
              {a.aiSummary ? (
                <div className="small">{(a.aiSummary as unknown as FunderReply).summary}</div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
