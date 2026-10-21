import { getPrisma } from "@mca/db";
import { requireUser } from "@/server/auth";
import { loadPlaybook } from "@/server/playbook";

export const dynamic = "force-dynamic";

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const money = (n: number | null) =>
  n === null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
const hours = (h: number | null) =>
  h === null
    ? "—"
    : h < 1
      ? "under 1 h"
      : h < 48
        ? `${Math.round(h)} h`
        : `${Math.round(h / 24)} days`;

/** What each lender did with Ascend's files, and how the team shops deals. */
export default async function LendersPage() {
  const user = await requireUser();
  const prisma = getPrisma();
  const [{ lenders, habits }, history] = await Promise.all([
    loadPlaybook(prisma, user.tenantId),
    prisma.mailboxConnection.count({ where: { tenantId: user.tenantId, purpose: "history" } }),
  ]);

  return (
    <>
      <h1>Lenders</h1>
      <p className="small muted">
        Built from every submission the CRM knows: sent from here, found in the funding inbox
        {history ? ", and read from past email" : ""}. Lender replies are read by AI; offers are
        what the lender wrote, not confirmed terms. These numbers also rank lenders on each deal.
        {history ? null : (
          <>
            {" "}
            To learn from older deals, connect a past mailbox in{" "}
            <a href="/settings">Settings → Learn from past email</a>.
          </>
        )}
      </p>

      <section className="panel">
        <h2>How you shop</h2>
        {habits.dealsShopped === 0 ? (
          <p className="empty">No submissions yet.</p>
        ) : (
          <div className="cols">
            <div>
              <ul className="habits">
                <li>
                  <strong>{habits.dealsShopped}</strong> deals sent to lenders, usually to{" "}
                  <strong>{habits.medianLendersPerDeal ?? "—"}</strong> lenders each (average{" "}
                  {habits.avgLendersPerDeal?.toFixed(1) ?? "—"}).
                </li>
                <li>
                  <strong>{habits.dealsWithPositions}</strong> of them listed existing positions
                  (usually {habits.medianPositions ?? 0}).
                </li>
                <li>
                  Sent most: {habits.mostSent.map((m) => `${m.name} (${m.count})`).join(", ")}.
                </li>
                {habits.sentTogether.length ? (
                  <li>
                    Usually sent together:{" "}
                    {habits.sentTogether.map((p) => `${p.a} + ${p.b} (${p.count})`).join(", ")}.
                  </li>
                ) : null}
              </ul>
            </div>
            <div>
              <h3>Answers by positions on the file</h3>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Positions</th>
                    <th>Sent</th>
                    <th>Approved</th>
                    <th>Declined</th>
                  </tr>
                </thead>
                <tbody>
                  {habits.byPositions.map((b) => (
                    <tr key={b.positions}>
                      <td>{b.positions}</td>
                      <td>{b.sent}</td>
                      <td>{b.approved}</td>
                      <td>{b.declined}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>By lender</h2>
        {lenders.length === 0 ? <p className="empty">No lender answers yet.</p> : null}
        {lenders.length ? (
          <div className="tablewrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Lender</th>
                  <th>Sent</th>
                  <th>Approved</th>
                  <th>Declined</th>
                  <th>Funded</th>
                  <th>Approval rate</th>
                  <th>Usual reply</th>
                  <th>Typical offer</th>
                  <th>Took</th>
                  <th>Why they declined</th>
                </tr>
              </thead>
              <tbody>
                {lenders.map((l) => (
                  <tr key={l.funderId}>
                    <td>
                      <strong>{l.name}</strong>
                      {l.pending ? <div className="small muted">{l.pending} waiting</div> : null}
                      {l.forwarded ? (
                        <div className="small muted">{l.forwarded} passed to a partner</div>
                      ) : null}
                    </td>
                    <td>{l.sent}</td>
                    <td>{l.approved}</td>
                    <td>{l.declined}</td>
                    <td>{l.funded}</td>
                    <td>{pct(l.approvalRate)}</td>
                    <td>{hours(l.medianReplyHours)}</td>
                    <td className="small">
                      {l.typicalOffer.offers ? (
                        <>
                          {money(l.typicalOffer.amount)}
                          {l.typicalOffer.factor ? ` · ${l.typicalOffer.factor}` : ""}
                          {l.typicalOffer.termDays ? ` · ${l.typicalOffer.termDays}d` : ""}
                          {l.typicalOffer.points !== null ? ` · ${l.typicalOffer.points} pts` : ""}
                          <div className="muted">
                            from {l.typicalOffer.offers} offer
                            {l.typicalOffer.offers === 1 ? "" : "s"}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="small">
                      {l.approved ? (
                        <>
                          {l.approvedGrades.length ? `Paper ${l.approvedGrades.join(", ")}` : ""}
                          {l.maxPositionsApproved !== null ? (
                            <div>up to {l.maxPositionsApproved} positions</div>
                          ) : null}
                          {l.approvedStates.length ? (
                            <div className="muted">{l.approvedStates.join(", ")}</div>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="small">
                      {l.declineReasons.length
                        ? l.declineReasons.map((r) => (
                            <div key={r.reason}>
                              {r.reason}
                              {r.count > 1 ? ` (${r.count})` : ""}
                            </div>
                          ))
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}
