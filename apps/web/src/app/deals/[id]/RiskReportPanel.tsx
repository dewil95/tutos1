import type { StoredRiskReport } from "@/server/jobs/riskReport";
import { regenerateRiskReport } from "./actions";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const LEVEL: Record<string, string> = {
  LOW: "low risk",
  MODERATE: "moderate risk",
  HIGH: "high risk",
  VERY_HIGH: "very high risk",
};

/** Internal AI Risk Report: for the Ascend team only, never attached to lender emails. */
export function RiskReportPanel({
  dealId,
  report,
  pdfLink,
  hasScrub,
}: {
  dealId: string;
  report: unknown;
  pdfLink: string | null;
  hasScrub: boolean;
}) {
  const r = report as StoredRiskReport | null;
  return (
    <section className="panel">
      <h2>
        AI Risk Report <span className="tag">internal</span>
      </h2>
      {!r ? (
        <p className="empty">
          {hasScrub
            ? "Generating after the bank scrub… refresh in a minute, or regenerate below."
            : "Created automatically after the bank scrub."}
        </p>
      ) : (
        <>
          <div className="risk-head">
            <div className={`risk-score ${r.risk.level.toLowerCase()}`}>
              <strong>{r.risk.score}</strong>
              <span>/ 100</span>
            </div>
            <div>
              <div className="small muted">
                {LEVEL[r.risk.level]} · paper grade {r.grade} ·{" "}
                {new Date(r.generatedAt).toLocaleString("en-US")}
              </div>
              <p className="headline">{r.narrative.headline}</p>
            </div>
          </div>
          <p>{r.narrative.summary}</p>
          <div className="cols">
            <div>
              <h3>Top risks</h3>
              <ul className="flags">
                {r.narrative.topRisks.map((x, i) => (
                  <li
                    key={i}
                    className={`flag ${x.severity === "high" ? "critical" : x.severity === "medium" ? "warning" : "info"}`}
                  >
                    <span className="sev">{x.severity}</span> <strong>{x.title}:</strong> {x.detail}
                  </li>
                ))}
              </ul>
              {r.narrative.mitigants.length ? (
                <>
                  <h3>Strengths</h3>
                  <ul className="small">
                    {r.narrative.mitigants.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <h3>Why this score</h3>
              <ul className="small muted">
                {r.risk.deductions.length ? (
                  r.risk.deductions.map((d, i) => (
                    <li key={i}>
                      −{d.points}: {d.reason}
                    </li>
                  ))
                ) : (
                  <li>No deductions.</li>
                )}
              </ul>
            </div>
            <div>
              <h3>Suggested structure</h3>
              <p className="small">
                {r.advance
                  ? `${money(r.advance.low)} – ${money(r.advance.high)} · factor ${r.advance.factorLow}–${r.advance.factorHigh} · ${r.advance.termMonthsLow}–${r.advance.termMonthsHigh} months`
                  : "Not enough revenue data."}
              </p>
              <h3>Lenders to try first</h3>
              <p className="small">{r.narrative.lenderStrategy}</p>
              <ol className="small">
                {r.lenders.map((l) => (
                  <li key={l.name}>
                    {l.name} <span className="muted">(fit {l.score})</span>
                  </li>
                ))}
              </ol>
              <h3>Ask the merchant</h3>
              <ul className="small">
                {r.narrative.questionsForMerchant.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
      <form action={regenerateRiskReport.bind(null, dealId)} className="row">
        {pdfLink ? (
          <a className="button" href={pdfLink} target="_blank" rel="noreferrer">
            Open PDF (Drive, Internal folder)
          </a>
        ) : null}
        {hasScrub ? <button type="submit">Regenerate</button> : null}
        <span className="small muted">Team only. It cannot be ticked for a lender package.</span>
      </form>
    </section>
  );
}
