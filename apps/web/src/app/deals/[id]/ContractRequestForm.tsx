import type { OfferOption } from "@mca/ai";
import { requestContracts } from "./actions";

/** Draft of the contract request Ascend sends today, filled from the AI-read offer; a person sends it. */
export function ContractRequestForm({
  dealId,
  submissionId,
  merchantEmail,
  offer,
  stipFiles,
}: {
  dealId: string;
  submissionId: string;
  merchantEmail: string | null;
  offer: OfferOption | null;
  stipFiles: { id: string; fileName: string }[];
}) {
  const term = offer?.termDays ?? offer?.numberOfPayments ?? null;
  return (
    <details className="contract">
      <summary>Request contracts</summary>
      <form action={requestContracts.bind(null, dealId)} className="stack small">
        <input type="hidden" name="submissionId" value={submissionId} />
        <div className="row">
          <label className="field">
            Amount
            <input
              name="amount"
              inputMode="decimal"
              required
              defaultValue={offer?.advanceAmount ?? ""}
              size={9}
            />
          </label>
          <label className="field">
            Factor
            <input
              name="factor"
              inputMode="decimal"
              required
              defaultValue={offer?.factorRate ?? ""}
              size={5}
            />
          </label>
          <label className="field">
            Term (days)
            <input
              name="termDays"
              inputMode="numeric"
              required
              defaultValue={term ?? ""}
              size={4}
            />
          </label>
        </div>
        <label className="field">
          Send contracts to (merchant email)
          <input name="merchantEmail" type="email" required defaultValue={merchantEmail ?? ""} />
        </label>
        {stipFiles.length ? (
          <fieldset className="small">
            <legend>Attach (DL / voided check)</legend>
            {stipFiles.map((f) => (
              <label key={f.id}>
                <input type="checkbox" name="documentIds" value={f.id} defaultChecked />{" "}
                {f.fileName}{" "}
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="warn">
            No DL or voided check on the deal yet; upload them first or send without.
          </p>
        )}
        <button type="submit">Send in the lender&apos;s thread</button>
      </form>
    </details>
  );
}
