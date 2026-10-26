import type { Metadata } from "next";
import { startApplication } from "./actions";
import { ApplyShell } from "./ApplyShell";
import { copyFor, type ErrorCode } from "./copy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Ascend Fund – apply",
  description: "Apply for business funding with Ascend Fund: upload, review and sign online.",
};

/** Public start: the merchant uploads their application and statements (?lang=es for Spanish). */
export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; error?: string }>;
}) {
  const q = await searchParams;
  const lang = q.lang === "es" ? "es" : "en";
  const t = copyFor(lang);
  const error = q.error && q.error in t.errors ? t.errors[q.error as ErrorCode] : null;
  return (
    <ApplyShell
      lang={lang}
      corner={
        <a className="lang-switch" href={`/application?lang=${lang === "es" ? "en" : "es"}`}>
          {t.other}
        </a>
      }
    >
      <h1>{t.startTitle}</h1>
      <p className="muted">{t.startIntro}</p>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      <form action={startApplication} className="stack">
        <input type="hidden" name="lang" value={lang} />
        {/* Left empty by people; bots fill it in. A meaningless name and display:none keep
            browser autofill away from it (autofill filled the old "company_website"). */}
        <div style={{ display: "none" }} aria-hidden="true">
          <input type="text" name="hp_x7" tabIndex={-1} autoComplete="off" />
        </div>
        <div className="row">
          <label className="field">
            {t.email}
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label className="field">
            {t.phone}
            <input name="phone" type="tel" autoComplete="tel" />
          </label>
        </div>
        <label className="field">
          {t.appFile}
          <input
            type="file"
            name="application"
            accept="application/pdf,image/jpeg,image/png"
            multiple
          />
          <span className="small muted">{t.appFileHint}</span>
        </label>
        <label className="field">
          {t.statements}
          <input type="file" name="statements" accept="application/pdf" multiple />
          <span className="small muted">
            {t.statementsHint} {t.sizeHint}
          </span>
        </label>
        <p>
          <button type="submit" className="button primary">
            {t.start}
          </button>
        </p>
        <p className="small muted">{t.privacy}</p>
      </form>
    </ApplyShell>
  );
}
