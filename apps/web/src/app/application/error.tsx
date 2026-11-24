"use client";

import { useEffect, useState } from "react";
import { ApplyShell } from "./ApplyShell";
import { copyFor } from "./copy";

/** Unexpected errors on the public application pages (upload too large, a bug): a plain page. */
export default function ApplicationError({ reset }: { error: Error; reset: () => void }) {
  const [lang, setLang] = useState<"en" | "es">("en");
  useEffect(() => {
    // The language lives in the URL (?lang=es); the browser's own language is the fallback.
    const q = new URLSearchParams(window.location.search).get("lang");
    setLang(q === "es" || (!q && navigator.language.startsWith("es")) ? "es" : "en");
  }, []);
  const t = copyFor(lang);
  return (
    <ApplyShell lang={lang}>
      <h1>{t.crashTitle}</h1>
      <p className="muted">{t.crashIntro}</p>
      <p>
        <button type="button" className="button primary" onClick={() => reset()}>
          {t.tryAgain}
        </button>
      </p>
    </ApplyShell>
  );
}
