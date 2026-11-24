import { appetiteSummary, type LenderRow } from "@/server/lenders";

/** One lender in "Ship the file": the tick, the fit, what the sheet says, where the email goes. */
export function LenderItem({ row, checked }: { row: LenderRow; checked: boolean }) {
  const { funder: f, to, cc, problem, already, eligible, score, reasons: all } = row;
  const appetite = appetiteSummary(f);
  const reasons = all.filter((r) => !appetite.includes(r));
  return (
    <li className={already || problem ? "disabled" : eligible ? "" : "outside"}>
      <div className="lender-head">
        <label>
          <input
            type="checkbox"
            name="funderIds"
            value={f.id}
            disabled={already || !!problem}
            defaultChecked={checked}
            data-recommended={!already && !problem && eligible ? "1" : undefined}
          />{" "}
          <strong>{f.name}</strong>
        </label>{" "}
        {!already && !problem ? (
          <span className={`score ${eligible ? "fit" : "nofit"}`} title="Fit score 0-100">
            {eligible ? `fit ${score}` : "outside appetite"}
          </span>
        ) : null}
        {already ? <span className="small muted"> already submitted for this merchant</span> : null}
        {problem ? <span className="small error"> {problem}</span> : null}
      </div>
      {appetite || (reasons.length && !already) ? (
        <div className="lender-meta small">
          {appetite ? <span className="appetite">{appetite}</span> : null}
          {appetite && reasons.length && !already ? " · " : ""}
          {reasons.length && !already ? (
            <span className={eligible ? "muted" : "warn"}>{reasons.join(" · ")}</span>
          ) : null}
        </div>
      ) : null}
      {!problem ? (
        <div
          className="addr"
          title={`To: ${to.join(", ")}${cc.length ? ` · CC: ${cc.join(", ")}` : ""}`}
        >
          To: {to.join(", ")}
          {cc.length ? ` · CC: ${cc.join(", ")}` : ""}
        </div>
      ) : null}
    </li>
  );
}
