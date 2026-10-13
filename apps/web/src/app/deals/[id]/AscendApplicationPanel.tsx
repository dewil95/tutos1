import type { OwnerPii } from "@/server/ascendApplication";
import type { Draft } from "@/server/whatsapp/questions";
import {
  rereadApplication,
  saveApplicationDetails,
  uploadSignedApplication,
} from "./applicationActions";

interface FileRef {
  id: string;
  fileName: string;
  driveWebViewLink: string | null;
  createdAt: Date;
}

const ENTITY_TYPES: [string, string][] = [
  ["LLC", "LLC"],
  ["CORP", "Corporation"],
  ["S_CORP", "S-Corp"],
  ["SOLE_PROP", "Sole proprietor"],
  ["PARTNERSHIP", "Partnership"],
  ["NONPROFIT", "Nonprofit"],
  ["OTHER", "Other"],
];

/**
 * Upload → Ascend application → signed copy. The other company's form stays team-only; the
 * signed Ascend application is the one that goes to lenders.
 */
export function AscendApplicationPanel({
  dealId,
  draft,
  pii,
  ownerIds,
  missing,
  source,
  signed,
  reading,
}: {
  dealId: string;
  draft: Draft;
  pii: OwnerPii[];
  ownerIds: string[];
  missing: string[];
  source: FileRef | null;
  signed: FileRef | null;
  reading: { state: "reading" | "failed" | "done" | "not_application"; error?: string } | null;
}) {
  const b = draft.business;
  const r = draft.request;
  const owners = [draft.owners[0] ?? {}, draft.owners[1] ?? {}];
  const open = (f: FileRef) =>
    f.driveWebViewLink ? (
      <a href={f.driveWebViewLink} target="_blank" rel="noreferrer">
        {f.fileName}
      </a>
    ) : (
      f.fileName
    );

  return (
    <section className="panel" id="ascend-application">
      <h2>Ascend application</h2>
      <ol className="steps">
        <li>
          <strong>Merchant&apos;s application</strong>{" "}
          {source ? (
            <>
              {open(source)} <span className="small muted">· team only, never sent to lenders</span>
              {reading?.state === "reading" ? (
                <div className="small">AI is reading it… refresh in a minute.</div>
              ) : null}
              {reading?.state === "done" ? (
                <div className="small ok">Read by AI. Check the details below.</div>
              ) : null}
              {reading?.state === "not_application" ? (
                <div className="small warn">
                  This file does not look like an application. Type the details below.
                </div>
              ) : null}
              {reading?.state === "failed" ? (
                <div className="small error">Reading failed: {reading.error?.slice(0, 160)}</div>
              ) : null}
              {reading?.state !== "reading" ? (
                <form action={rereadApplication.bind(null, dealId)} className="inline">
                  <input type="hidden" name="documentId" value={source.id} />
                  <button type="submit">Read again</button>
                </form>
              ) : null}
            </>
          ) : (
            <span className="small muted">
              none uploaded (start a deal from <a href="/deals/new">New deal</a> to have AI fill
              this in).
            </span>
          )}
        </li>

        <li>
          <strong>Check the details</strong>{" "}
          {missing.length ? (
            <span className="small warn">Missing: {missing.join(", ")}</span>
          ) : (
            <span className="small ok">All required fields are filled.</span>
          )}
          <details open={missing.length > 0}>
            <summary className="small">Edit application details</summary>
            <form action={saveApplicationDetails.bind(null, dealId)} className="stack appform">
              <fieldset>
                <legend>Business</legend>
                <div className="row">
                  <label className="field">
                    Legal name *
                    <input name="legalName" defaultValue={b.legalName ?? ""} required />
                  </label>
                  <label className="field">
                    DBA
                    <input name="dba" defaultValue={b.dba ?? ""} />
                  </label>
                  <label className="field">
                    Entity type
                    <select name="entityType" defaultValue={b.entityType ?? ""}>
                      <option value="">—</option>
                      {ENTITY_TYPES.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="row">
                  <label className="field">
                    EIN
                    <input
                      name="ein"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder={
                        b.ein ? `on file …${b.ein.slice(-4)} · blank keeps it` : "12-3456789"
                      }
                    />
                  </label>
                  <label className="field">
                    Start date
                    <input name="startDate" type="date" defaultValue={b.startDate ?? ""} />
                  </label>
                  <label className="field">
                    Industry
                    <input name="industry" defaultValue={b.industry ?? ""} />
                  </label>
                </div>
                <div className="row">
                  <label className="field">
                    Address
                    <input name="line1" defaultValue={b.address?.line1 ?? ""} />
                  </label>
                  <label className="field">
                    City
                    <input name="city" defaultValue={b.address?.city ?? ""} />
                  </label>
                  <label className="field">
                    State
                    <input
                      name="state"
                      maxLength={2}
                      size={3}
                      defaultValue={b.address?.state ?? ""}
                    />
                  </label>
                  <label className="field">
                    ZIP
                    <input name="postalCode" size={6} defaultValue={b.address?.postalCode ?? ""} />
                  </label>
                </div>
                <div className="row">
                  <label className="field">
                    Phone
                    <input name="phone" defaultValue={b.phone ?? ""} />
                  </label>
                  <label className="field">
                    Email
                    <input name="email" type="email" defaultValue={b.email ?? ""} />
                  </label>
                  <label className="field">
                    Website
                    <input name="website" defaultValue={b.website ?? ""} />
                  </label>
                </div>
              </fieldset>

              <fieldset>
                <legend>Funding request</legend>
                <div className="row">
                  <label className="field">
                    Amount requested
                    <input name="amount" inputMode="decimal" defaultValue={r.amount ?? ""} />
                  </label>
                  <label className="field">
                    Monthly revenue (stated)
                    <input
                      name="monthlyRevenue"
                      inputMode="decimal"
                      defaultValue={r.monthlyRevenue ?? ""}
                    />
                  </label>
                  <label className="field">
                    Use of funds
                    <input name="useOfFunds" defaultValue={r.useOfFunds ?? ""} />
                  </label>
                </div>
                <p className="small muted">
                  Current advances come from the positions box in &quot;Ship the file&quot;.
                </p>
              </fieldset>

              {owners.map((o, i) => (
                <fieldset key={i}>
                  <legend>
                    Owner {i + 1}
                    {i === 1 ? " (optional)" : ""}
                  </legend>
                  <input type="hidden" name={`ownerId-${i}`} value={ownerIds[i] ?? ""} />
                  <div className="row">
                    <label className="field">
                      First name
                      <input name={`firstName-${i}`} defaultValue={o.firstName ?? ""} />
                    </label>
                    <label className="field">
                      Last name
                      <input name={`lastName-${i}`} defaultValue={o.lastName ?? ""} />
                    </label>
                    <label className="field">
                      Ownership %
                      <input
                        name={`pct-${i}`}
                        inputMode="decimal"
                        size={5}
                        defaultValue={o.ownershipPct ?? ""}
                      />
                    </label>
                  </div>
                  <div className="row">
                    <label className="field">
                      SSN
                      <input
                        name={`ssn-${i}`}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder={
                          pii[i]?.ssn
                            ? `on file …${pii[i]!.ssn!.slice(-4)} · blank keeps it`
                            : "123-45-6789"
                        }
                      />
                    </label>
                    <label className="field">
                      Date of birth{" "}
                      {pii[i]?.dob ? <span className="small muted">(on file)</span> : null}
                      <input name={`dob-${i}`} type="date" autoComplete="off" />
                    </label>
                    <label className="field">
                      Credit score (est.)
                      <input
                        name={`score-${i}`}
                        inputMode="numeric"
                        size={4}
                        defaultValue={o.creditScore ?? ""}
                      />
                    </label>
                  </div>
                  <div className="row">
                    <label className="field">
                      Home address
                      <input name={`line1-${i}`} defaultValue={o.address?.line1 ?? ""} />
                    </label>
                    <label className="field">
                      City
                      <input name={`city-${i}`} defaultValue={o.address?.city ?? ""} />
                    </label>
                    <label className="field">
                      State
                      <input
                        name={`state-${i}`}
                        maxLength={2}
                        size={3}
                        defaultValue={o.address?.state ?? ""}
                      />
                    </label>
                    <label className="field">
                      ZIP
                      <input
                        name={`postalCode-${i}`}
                        size={6}
                        defaultValue={o.address?.postalCode ?? ""}
                      />
                    </label>
                  </div>
                  <div className="row">
                    <label className="field">
                      Email
                      <input name={`email-${i}`} type="email" defaultValue={o.email ?? ""} />
                    </label>
                    <label className="field">
                      Phone
                      <input name={`phone-${i}`} defaultValue={o.phone ?? ""} />
                    </label>
                  </div>
                </fieldset>
              ))}
              <p>
                <button type="submit">Save details</button>{" "}
                <span className="small muted">SSN, DOB and EIN are stored encrypted.</span>
              </p>
            </form>
          </details>
        </li>

        <li>
          <strong>Download Ascend&apos;s application</strong>{" "}
          <a className="button" href={`/deals/${dealId}/ascend-application.pdf`}>
            Download PDF
          </a>
          <div className="small muted">
            Filled from the details above, with an empty signature line for the merchant. It shows
            the full SSN and date of birth: send it to the merchant through DocuSign or another
            secure channel, not plain email.
          </div>
        </li>

        <li>
          <strong>Upload the signed application</strong>{" "}
          {signed ? (
            <span className="small ok">
              Ready to ship: {open(signed)} (ticked for lenders below)
            </span>
          ) : (
            <span className="small warn">Not signed yet</span>
          )}
          <form action={uploadSignedApplication.bind(null, dealId)} className="row">
            <input
              type="file"
              name="signed"
              accept="application/pdf,image/jpeg,image/png"
              multiple
              required
            />
            <button type="submit">{signed ? "Replace signed copy" : "Upload signed copy"}</button>
          </form>
        </li>
      </ol>
    </section>
  );
}
