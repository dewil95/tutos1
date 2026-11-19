import type { Metadata } from "next";
import { startApplication } from "./actions";
import { ApplyShell } from "./ApplyShell";
import { StartForm } from "./StartForm";
import { copyFor, type ErrorCode } from "./copy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Apply for business funding",
  description: "Upload your application and bank statements.",
};

/** Public start: just the application and the bank statements (?lang=es for Spanish). */
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
      <StartForm
        lang={lang}
        action={startApplication}
        t={{
          appFile: t.appFile,
          appFileHint: t.appFileHint,
          statements: t.statements,
          statementsHint: t.statementsHint,
          sizeHint: t.sizeHint,
          start: t.start,
          busy: t.busy,
          privacy: t.privacy,
          tooBig: t.tooBig,
        }}
      />
    </ApplyShell>
  );
}
