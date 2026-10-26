import { getPrisma } from "@mca/db";
import type { Metadata } from "next";
import { dealApplication } from "@/server/ascendApplication";
import {
  findWebApplication,
  readingInProgress,
  reviewSnapshot,
  type Lang,
} from "@/server/webApplication";
import { addStatements, sign, switchLanguage } from "../actions";
import { copyFor, type Copy, type ErrorCode } from "../copy";
import { DetailsForm, type FormValues } from "./DetailsForm";
import { ApplyShell } from "../ApplyShell";
import { SignaturePad } from "./SignaturePad";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your application",
  robots: { index: false, follow: false },
  // The link is the merchant's key: never send it to other sites in the Referer header.
  referrer: "no-referrer",
};

type Params = { step?: string; error?: string; added?: string; signed?: string };

export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Params>;
}) {
  const { token } = await params;
  const q = await searchParams;
  const prisma = getPrisma();
  const row = await findWebApplication(prisma, token);
  const lang: Lang = row?.lang === "es" ? "es" : "en";
  const t = copyFor(lang);
  const switchTo = switchLanguage.bind(null, token, lang === "es" ? "en" : "es");
  const errorText =
    q.error && q.error in t.errors
      ? t.errors[q.error as ErrorCode]
      : q.error
        ? t.errors.failed
        : null;

  if (!row) {
    return (
      <ApplyShell lang={lang}>
        <h1>{t.expiredTitle}</h1>
        <p className="muted">{t.expiredIntro}</p>
        <a className="button primary" href="/application">
          {t.startOver}
        </a>
      </ApplyShell>
    );
  }
  const languageSwitch = (
    <form action={switchTo} className="lang-switch">
      <button type="submit" className="link">
        {t.other}
      </button>
    </form>
  );

  if (row.signedAt) {
    return (
      <ApplyShell lang={lang} corner={languageSwitch}>
        <h1>{t.signedTitle}</h1>
        <p className="muted">{t.signedIntro}</p>
        {row.signatureId ? (
          <a className="button" href={`/application/${encodeURIComponent(token)}/copy`}>
            {t.copy}
          </a>
        ) : null}
      </ApplyShell>
    );
  }

  if (await readingInProgress(prisma, row.dealId)) {
    return (
      <ApplyShell lang={lang} corner={languageSwitch}>
        <meta httpEquiv="refresh" content="4" />
        <h1>{t.reading}</h1>
        <p className="muted">{t.readingHint}</p>
        <div className="spinner" aria-hidden="true" />
      </ApplyShell>
    );
  }

  const statements = await prisma.document.count({
    where: { dealId: row.dealId, type: "BANK_STATEMENT" },
  });

  // Everything was read from the upload: straight to review and sign, nothing to type.
  const snap = q.step === "details" ? null : await reviewSnapshot(prisma, row);
  if (snap && !snap.missing.length) {
    return (
      <ApplyShell lang={lang} corner={languageSwitch} wide>
        <h1>{t.reviewTitle}</h1>
        <p className="muted">{t.reviewIntro}</p>
        {errorText ? (
          <p className="notice error" role="alert">
            {errorText}
          </p>
        ) : null}
        <div className="review">
          {snap.masked.map((s) => (
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
        <p>
          <a href={`/application/${encodeURIComponent(token)}?step=details`}>{t.edit}</a>
        </p>
        <SignForm token={token} t={t} snap={snap} />
      </ApplyShell>
    );
  }
  if (snap && q.step === "review") {
    return (
      <ApplyShell lang={lang} corner={languageSwitch}>
        <h1>{t.reviewTitle}</h1>
        <p className="notice warn">
          {t.missing} {snap.missing.join(", ")}
        </p>
        <a
          className="button primary"
          href={`/application/${encodeURIComponent(token)}?step=details`}
        >
          {t.edit}
        </a>
      </ApplyShell>
    );
  }

  const values = await formValues(prisma, row);
  return (
    <ApplyShell lang={lang} corner={languageSwitch} wide>
      <h1>{t.checkTitle}</h1>
      <p className="muted">{t.checkIntro}</p>
      {errorText ? (
        <p className="notice error" role="alert">
          {errorText}
        </p>
      ) : null}
      {values ? <DetailsForm token={token} lang={lang} values={values} /> : null}
      <section className="panel">
        <h2>{t.addStatements}</h2>
        <p className="small muted">
          {t.addStatementsHint} {t.filesOnFile(statements)}
        </p>
        {q.added ? <p className="notice ok">{t.uploaded(Number(q.added) || 0)}</p> : null}
        <form action={addStatements.bind(null, token)} className="row">
          <input type="file" name="statements" accept="application/pdf" multiple required />
          <button type="submit">{t.upload}</button>
        </form>
        <p className="small muted">{t.sizeHint}</p>
      </section>
    </ApplyShell>
  );
}

function SignForm({
  token,
  t,
  snap,
}: {
  token: string;
  t: Copy;
  snap: NonNullable<Awaited<ReturnType<typeof reviewSnapshot>>>;
}) {
  return (
    <form action={sign.bind(null, token)} className="panel stack sign">
      <input type="hidden" name="fingerprint" value={snap.fingerprint} />
      <h2>{t.authorization}</h2>
      <p className="small consent">{snap.consent.authorization}</p>
      {snap.consent.translation ? (
        <>
          <h3>{t.translation}</h3>
          <p className="small consent">{snap.consent.translation}</p>
        </>
      ) : null}
      <label className="check">
        <input type="checkbox" name="agree" value="yes" required />
        <span>{snap.consent.agreement}</span>
      </label>
      <SignaturePad
        name="drawing"
        label={t.drawSignature}
        clearLabel={t.clearSignature}
        requiredMessage={t.errors.drawing}
      />
      <label className="field">
        {t.typeName}
        <input name="name" autoComplete="name" required minLength={3} />
      </label>
      <p>
        <button type="submit" className="button primary">
          {t.sign}
        </button>
      </p>
    </form>
  );
}

/** What the details form starts with: the deal's application, contact from the start page. */
async function formValues(
  prisma: ReturnType<typeof getPrisma>,
  row: { tenantId: string; dealId: string; email: string | null; phone: string | null },
): Promise<FormValues | null> {
  const app = await dealApplication(prisma, row.tenantId, row.dealId);
  if (!app) return null;
  const b = app.draft.business;
  const r = app.draft.request;
  const s = (v: string | number | undefined | null) =>
    v === undefined || v === null ? "" : String(v);
  const owners = [0, 1].map((i) => {
    const o = app.draft.owners[i] ?? {};
    const saved = app.owners[i];
    return {
      id: saved?.id ?? "",
      values: {
        firstName: s(o.firstName),
        lastName: s(o.lastName),
        pct: s(o.ownershipPct),
        score: s(o.creditScore),
        line1: s(o.address?.line1),
        city: s(o.address?.city),
        state: s(o.address?.state),
        postalCode: s(o.address?.postalCode),
        email: s(o.email ?? (i === 0 ? row.email : null)),
        phone: s(o.phone ?? (i === 0 ? row.phone : null)),
      },
      ssnLast4: app.pii[i]?.ssn?.slice(-4) ?? null,
      dobOnFile: Boolean(app.pii[i]?.dob),
    };
  });
  return {
    business: {
      legalName: s(b.legalName),
      dba: s(b.dba),
      entityType: s(b.entityType),
      startDate: s(b.startDate),
      industry: s(b.industry),
      line1: s(b.address?.line1),
      city: s(b.address?.city),
      state: s(b.address?.state),
      postalCode: s(b.address?.postalCode),
      phone: s(b.phone),
      email: s(b.email ?? row.email),
      website: s(b.website),
      amount: s(r.amount),
      monthlyRevenue: s(r.monthlyRevenue),
      useOfFunds: s(r.useOfFunds),
    },
    owners,
    einLast4: b.ein ? b.ein.slice(-4) : null,
  };
}
