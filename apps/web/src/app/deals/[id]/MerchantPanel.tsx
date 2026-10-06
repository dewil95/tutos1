import type { Deal, Merchant, Owner } from "@mca/db";
import type { FieldConflict } from "@/server/applicationData";
import { resolveConflict, setEmailOptOut } from "./actions";

interface AppData {
  readAt?: string;
  signed?: boolean;
  lowConfidenceFields?: string[];
  conflicts?: FieldConflict[];
}

const row = (label: string, value: string | null | undefined) =>
  value ? (
    <div className="kv" key={label}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  ) : null;

/** Merchant and owner facts (SSN/DOB/EIN only as last 4) plus anything the AI read differently. */
export function MerchantPanel({
  deal,
  merchant,
  owners,
}: {
  deal: Deal;
  merchant: Merchant;
  owners: Owner[];
}) {
  const app = (deal.applicationData ?? {}) as AppData;
  const conflicts = app.conflicts ?? [];
  const address = [merchant.addressLine1, merchant.city, merchant.state, merchant.postalCode]
    .filter(Boolean)
    .join(", ");
  return (
    <section className="panel">
      <h2>Merchant &amp; owners</h2>
      <p className="small muted">
        Source: {deal.source}
        {deal.externalRef ? ` · website ref ${deal.externalRef}` : ""}
        {app.readAt
          ? ` · application read by AI ${new Date(app.readAt).toLocaleString("en-US")}`
          : ""}
        {app.signed === false ? " · application not signed" : ""}
      </p>
      <div className="cols">
        <dl className="kvs">
          {row("Legal name", merchant.legalName)}
          {row("DBA", merchant.dba)}
          {row("Entity", merchant.entityType)}
          {row("EIN", merchant.einLast4 ? `…${merchant.einLast4}` : null)}
          {row("Started", merchant.startDate?.toISOString().slice(0, 10))}
          {row("Industry", merchant.industry)}
          {row("Email", merchant.email)}
          {row("Phone", merchant.phone)}
          {row("Address", address)}
          {row("Use of funds", deal.useOfFunds)}
        </dl>
        <div>
          {owners.length === 0 ? <p className="empty">No owners yet.</p> : null}
          {owners.map((o) => (
            <dl className="kvs owner" key={o.id}>
              {row("Owner", `${o.firstName} ${o.lastName}${o.isPrimary ? " (primary)" : ""}`)}
              {row("Ownership", o.ownershipPct ? `${Number(o.ownershipPct)}%` : null)}
              {row("SSN", o.ssnLast4 ? `…${o.ssnLast4}` : null)}
              {row("Email", o.email)}
              {row("Phone", o.phone)}
              {row("Credit (stated)", o.ficoEstimate ? String(o.ficoEstimate) : null)}
            </dl>
          ))}
        </div>
      </div>
      {conflicts.length ? (
        <>
          <h3>The application says something different</h3>
          <ul className="conflicts">
            {conflicts.map((c) => (
              <li key={c.field} className="row small">
                <strong>{c.field.replace(/^merchant\./, "")}</strong>
                <span>
                  saved: {c.current} · application: {c.fromApplication}
                </span>
                <form action={resolveConflict.bind(null, deal.id)} className="inline">
                  <input type="hidden" name="field" value={c.field} />
                  {c.field.startsWith("merchant.") && c.field !== "merchant.ein" ? (
                    <button type="submit" name="choice" value="application">
                      Use application
                    </button>
                  ) : null}{" "}
                  <button type="submit" name="choice" value="keep">
                    Keep saved
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <form action={setEmailOptOut.bind(null, deal.id)} className="row small">
        <input type="hidden" name="optOut" value={merchant.emailOptOut ? "off" : "on"} />
        <span className="muted">
          Automated emails to this merchant: {merchant.emailOptOut ? "off" : "on"}
        </span>
        <button type="submit">
          {merchant.emailOptOut ? "Turn back on" : "Stop automated emails"}
        </button>
      </form>
      {app.lowConfidenceFields?.length ? (
        <p className="small warn">
          Hard to read on the application: {app.lowConfidenceFields.join(", ")}
        </p>
      ) : null}
    </section>
  );
}
