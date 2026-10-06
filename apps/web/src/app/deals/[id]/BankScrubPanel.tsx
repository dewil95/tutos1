import type { BankAnalysis } from "@mca/db";
import type { BankMetrics, FinancingDebit, ScrubFlag, ScrubReport } from "@mca/domain";
import { verifyScrub } from "./actions";

interface FileCheck {
  documentId: string;
  fileName: string;
  metadataFlags: { code: string; message: string }[];
  visualFindings: { issue: string; severity: string; page: number | null; evidence: string }[];
  looksAuthentic: boolean | null;
}

interface StoredScrub {
  report: ScrubReport;
  files: FileCheck[];
  ruleGrade?: { grade: string; reasons?: string[] };
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

function Flag({ f }: { f: ScrubFlag | { severity: string; message: string } }) {
  return (
    <li className={`flag ${f.severity}`}>
      <span className="sev">{f.severity}</span> {f.message}
    </li>
  );
}

/** Month-by-month bank scrub with every flag explained; a person marks it verified. */
export function BankScrubPanel({
  dealId,
  analysis,
  pending,
}: {
  dealId: string;
  analysis: BankAnalysis | null;
  pending: number;
}) {
  if (!analysis?.scrub) {
    return (
      <section className="panel">
        <h2>Bank scrub</h2>
        <p className="empty">
          {pending
            ? `Reading ${pending} statement(s)… refresh in a minute.`
            : "Statements are scrubbed automatically when they arrive (email, upload or website). Tick statements above and use “Re-run bank scrub” to redo it."}
        </p>
      </section>
    );
  }
  const s = analysis.scrub as unknown as StoredScrub;
  const m = analysis.metrics as unknown as BankMetrics;
  const r = s.report;
  const critical = r.flags.filter((f) => f.severity === "critical").length;
  const warnings = r.flags.filter((f) => f.severity === "warning").length;
  const fileIssues = s.files.flatMap((f) => [
    ...f.metadataFlags.map((x) => ({
      severity: "warning",
      message: `${f.fileName}: ${x.message}`,
    })),
    ...f.visualFindings.map((x) => ({
      severity: x.severity,
      message: `${f.fileName}${x.page ? ` p.${x.page}` : ""}: ${x.evidence}`,
    })),
  ]);

  return (
    <section className="panel">
      <h2>Bank scrub</h2>
      <div className="stats">
        <div>
          <span className="k">Grade</span>
          <strong>{analysis.paperGrade ?? "—"}</strong>
        </div>
        <div>
          <span className="k">Avg true revenue</span>
          <strong>{money(m.avgMonthlyTrueRevenue)}</strong>
        </div>
        <div>
          <span className="k">Avg daily balance</span>
          <strong>{money(m.avgDailyBalance)}</strong>
        </div>
        <div>
          <span className="k">NSFs / 90 days</span>
          <strong>{m.nsfPer90Days}</strong>
        </div>
        <div>
          <span className="k">Existing payments</span>
          <strong>
            {money(r.monthlyFinancingPayments)}/mo · {pct(r.holdbackBurdenPct)}
          </strong>
        </div>
        <div>
          <span className="k">Flags</span>
          <strong>
            <span className="error">{critical} critical</span> ·{" "}
            <span className="warn">{warnings} warnings</span>
          </strong>
        </div>
      </div>

      <div className="tablewrap">
        <table className="grid num">
          <thead>
            <tr>
              <th>Month</th>
              <th>Deposits</th>
              <th>True revenue</th>
              <th># dep.</th>
              <th>ADB</th>
              <th>NSF</th>
              <th>Neg. days</th>
              <th>Ending</th>
              <th>Adds up</th>
            </tr>
          </thead>
          <tbody>
            {r.months.map((mo) => (
              <tr key={`${mo.month}-${mo.accountLast4}`}>
                <td>
                  {mo.month}
                  {mo.accountLast4 ? (
                    <span className="muted small"> …{mo.accountLast4}</span>
                  ) : null}
                  {!mo.isComplete ? <span className="warn small"> partial</span> : null}
                </td>
                <td>{money(mo.deposits)}</td>
                <td>{money(mo.trueRevenue)}</td>
                <td>{mo.depositCount}</td>
                <td>{money(mo.averageDailyBalance)}</td>
                <td className={mo.nsfCount > 3 ? "warn" : ""}>{mo.nsfCount}</td>
                <td className={mo.negativeDays > 5 ? "warn" : ""}>{mo.negativeDays}</td>
                <td>{money(mo.endingBalance)}</td>
                <td className={Math.abs(mo.reconciliationGap) > 5 ? "error" : "ok"}>
                  {Math.abs(mo.reconciliationGap) > 5
                    ? `off ${money(Math.abs(mo.reconciliationGap))}`
                    : "yes"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {r.flags.length ? (
        <>
          <h3>What to check</h3>
          <ul className="flags">
            {r.flags.map((f, i) => (
              <Flag key={i} f={f} />
            ))}
          </ul>
        </>
      ) : (
        <p className="small ok">
          No scrub flags: balances add up month to month and nothing unusual stood out.
        </p>
      )}

      {r.financing.length ? (
        <>
          <h3>Existing advances seen on the statements</h3>
          <ul className="small">
            {r.financing.map((f: FinancingDebit) => (
              <li key={`${f.descriptor}-${f.amount}`}>
                {f.descriptor}: {money(f.amount)} {f.frequency} (≈ {money(f.monthlyAmount)}/mo),{" "}
                {f.firstDate} → {f.lastDate}
                {f.active ? "" : " · stopped"}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3>Document integrity</h3>
      {fileIssues.length ? (
        <ul className="flags">
          {fileIssues.map((f, i) => (
            <Flag key={i} f={f} />
          ))}
        </ul>
      ) : (
        <p className="small ok">No signs of editing found in {s.files.length} file(s).</p>
      )}
      <p className="small muted">
        Hints for a person to check against the original PDF, never an automatic decline.
      </p>

      <form action={verifyScrub.bind(null, dealId)} className="row">
        <input type="hidden" name="analysisId" value={analysis.id} />
        {analysis.verifiedAt ? (
          <span className="small ok">
            Checked by a person on {analysis.verifiedAt.toLocaleString("en-US")}
          </span>
        ) : (
          <button type="submit">I checked these numbers against the statements</button>
        )}
      </form>
    </section>
  );
}
