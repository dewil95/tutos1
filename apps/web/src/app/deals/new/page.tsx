import { getPrisma } from "@mca/db";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { readingInProgress, reviewSnapshot } from "@/server/webApplication";
import { SignaturePad } from "@/app/application/[token]/SignaturePad";
import { signHereNow } from "../[id]/applicationActions";
import { createDealFromApplication } from "./actions";

/**
 * Step 2 of New deal: once the upload is read, the merchant (with the team) checks Ascend's
 * application on this screen and signs it in the box. Then the deal opens.
 */
async function SignStep({ dealId, error }: { dealId: string; error?: string }) {
  const user = await requireUser();
  const prisma = getPrisma();
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, tenantId: user.tenantId },
    select: { id: true, applicationData: true },
  });
  if (!deal) notFound();
  const dealPage = `/deals/${deal.id}`;
  if ((deal.applicationData as { signed?: boolean } | null)?.signed) {
    redirect(`${dealPage}?signed=1#ascend-application`);
  }
  if (await readingInProgress(prisma, deal.id)) {
    return (
      <>
        {/* Reading takes seconds: the page refreshes itself until it is done. */}
        <meta httpEquiv="refresh" content="4" />
        <p className="muted">
          Reading the application… the box to sign appears here as soon as it is done. This page
          refreshes by itself.
        </p>
        <div className="spinner" aria-hidden="true" />
      </>
    );
  }
  const snap = await reviewSnapshot(prisma, {
    tenantId: user.tenantId,
    dealId: deal.id,
    lang: "en",
  });
  if (!snap) notFound();
  const owner = snap.app.draft.owners[0];
  const ownerName = `${owner?.firstName ?? ""} ${owner?.lastName ?? ""}`.trim();
  return (
    <>
      {error ? <p className="notice error">{error}</p> : null}
      {snap.missing.length ? (
        <>
          <p className="notice warn">
            The application could not be filled in completely. Missing: {snap.missing.join(", ")}.
            Photos and scans are read by the AI; a digital PDF is read without it.
          </p>
          <p>
            <a className="button primary" href={`${dealPage}#ascend-application`}>
              Fill in the details on the deal
            </a>{" "}
            <span className="small muted">
              then sign in &quot;Sign right here&quot; on the deal page.
            </span>
          </p>
        </>
      ) : (
        <>
          <p className="muted">
            The merchant checks the details, ticks the agreement and signs in the box.
          </p>
          <div className="review">
            {snap.full.map((s) => (
              <section key={s.heading}>
                <h2>{s.heading}</h2>
                <dl>
                  {s.fields
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                </dl>
              </section>
            ))}
          </div>
          <p className="small">
            Something wrong? <a href={`${dealPage}#ascend-application`}>Fix it on the deal</a>.
          </p>
          <form action={signHereNow.bind(null, deal.id)} className="stack sign">
            <input type="hidden" name="fingerprint" value={snap.fingerprint} />
            <input type="hidden" name="from" value="new" />
            <h2>Terms of use</h2>
            <p className="small consent">{snap.consent.authorization}</p>
            <label className="check">
              <input type="checkbox" name="agree" value="yes" required />
              <span>{snap.consent.agreement}</span>
            </label>
            <SignaturePad
              name="drawing"
              label="Signature"
              clearLabel="Clear"
              requiredMessage="Draw the signature in the box."
            />
            <p>
              <button type="submit" className="primary">
                Sign as {ownerName}
              </button>
            </p>
          </form>
        </>
      )}
      <p className="small">
        <a href={dealPage}>Skip, open the deal</a>
      </p>
    </>
  );
}

/** Step 1 done: what was uploaded for this deal. */
async function Uploaded({ dealId }: { dealId: string }) {
  const user = await requireUser();
  const docs = await getPrisma().document.findMany({
    where: {
      dealId,
      tenantId: user.tenantId,
      OR: [{ type: "BANK_STATEMENT" }, { type: "APPLICATION", internalOnly: true }],
    },
    select: { id: true, fileName: true, type: true },
    orderBy: { createdAt: "asc" },
  });
  return (
    <>
      <ul className="small">
        {docs.map((d) => (
          <li key={d.id}>
            <span className="ok">✓</span> {d.type === "APPLICATION" ? "Application" : "Statement"}:{" "}
            {d.fileName}
          </li>
        ))}
      </ul>
      <p className="small">
        <a href="/deals/new">Start another deal</a>
      </p>
    </>
  );
}

async function createDeal(form: FormData) {
  "use server";
  const user = await requireUser();
  const prisma = getPrisma();
  const text = (k: string) => String(form.get(k) ?? "").trim() || null;
  const legalName = text("legalName");
  if (!legalName) redirect("/deals/new?error=Business+name+is+required");
  const amount = Number(String(form.get("requestedAmount") ?? "").replace(/[$,\s]/g, ""));
  const merchant = await prisma.merchant.create({
    data: {
      tenantId: user.tenantId,
      legalName,
      dba: text("dba"),
      email: text("email")?.toLowerCase() ?? null,
      phone: text("phone"),
      state: text("state")?.toUpperCase().slice(0, 2) ?? null,
      industry: text("industry"),
    },
  });
  const deal = await prisma.deal.create({
    data: {
      tenantId: user.tenantId,
      merchantId: merchant.id,
      ownerId: user.id,
      requestedAmount: Number.isFinite(amount) && amount > 0 ? amount : null,
      stage: "DOCS_REQUESTED",
    },
  });
  redirect(`/deals/${deal.id}`);
}

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; deal?: string }>;
}) {
  await requireUser();
  const { error, deal } = await searchParams;
  return (
    <section className="panel narrow">
      <h1>New deal</h1>
      {error && !deal ? <p className="notice error">{error}</p> : null}

      <h2>1. Merchant&apos;s application and bank statements</h2>
      {deal ? (
        <Uploaded dealId={deal} />
      ) : (
        <>
          <p className="small muted">
            Upload the application the merchant signed with another company (PDF, or photos of the
            pages). AI reads it and fills Ascend&apos;s application. That file stays with the team
            and is never sent to lenders.
          </p>
          <form action={createDealFromApplication} className="stack">
            <label className="field">
              Application (PDF or JPG/PNG photos) *
              <input
                type="file"
                name="application"
                accept="application/pdf,image/jpeg,image/png"
                multiple
                required
              />
            </label>
            <label className="field">
              Bank statements (optional, PDF)
              <input type="file" name="statements" accept="application/pdf" multiple />
            </label>
            <p className="small muted">Up to 10 MB in total per upload.</p>
            <button type="submit" className="primary">
              Upload and read the application
            </button>
          </form>
        </>
      )}

      <h2>2. Merchant signs Ascend&apos;s application here</h2>
      {deal ? (
        <SignStep dealId={deal} error={error} />
      ) : (
        <>
          <div className="sigpad sigpad-waiting" aria-hidden="true" />
          <p className="small muted">
            Upload the application above: Ascend&apos;s application is filled in from it and the
            merchant checks it and signs in this box.
          </p>
        </>
      )}

      {deal ? null : (
        <details>
          <summary className="small">No application? Type the deal in</summary>
          <form action={createDeal} className="stack">
            <label className="field">
              Business legal name *
              <input name="legalName" required />
            </label>
            <label className="field">
              DBA (used in the email subject if set)
              <input name="dba" />
            </label>
            <label className="field">
              Merchant email (their attachments get filed automatically)
              <input name="email" type="email" />
            </label>
            <label className="field">
              Phone
              <input name="phone" />
            </label>
            <div className="row">
              <label className="field">
                State
                <input name="state" maxLength={2} size={3} />
              </label>
              <label className="field">
                Industry
                <input name="industry" />
              </label>
              <label className="field">
                Requested amount
                <input name="requestedAmount" inputMode="decimal" />
              </label>
            </div>
            <button type="submit">Create deal</button>
          </form>
        </details>
      )}
    </section>
  );
}
