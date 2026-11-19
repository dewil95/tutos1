"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

const MAX_BYTES = 9 * 1024 * 1024;

export interface StartFormProps {
  lang: "en" | "es";
  action: (form: FormData) => Promise<void>;
  t: {
    appFile: string;
    appFileHint: string;
    statements: string;
    statementsHint: string;
    sizeHint: string;
    start: string;
    busy: string;
    privacy: string;
    tooBig: string;
  };
}

function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button primary" disabled={pending} aria-busy={pending}>
      {pending ? busy : idle}
    </button>
  );
}

/**
 * The public upload form. The button disables itself while the files go up (a second tap used
 * to start a second deal), and files over the server's limit are refused before the upload.
 */
export function StartForm({ lang, action, t }: StartFormProps) {
  const [tooBig, setTooBig] = useState(false);
  return (
    <form
      action={action}
      className="stack"
      onSubmit={(e) => {
        const form = e.currentTarget;
        let total = 0;
        for (const input of form.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
          for (const f of input.files ?? []) total += f.size;
        }
        if (total > MAX_BYTES) {
          e.preventDefault();
          setTooBig(true);
        }
      }}
    >
      <input type="hidden" name="lang" value={lang} />
      {/* Left empty by people; bots fill it in. A meaningless name and display:none keep
          browser autofill away from it (autofill filled the old "company_website"). */}
      <div style={{ display: "none" }} aria-hidden="true">
        <input type="text" name="hp_x7" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="field">
        {t.appFile}
        <input
          type="file"
          name="application"
          accept="application/pdf,image/jpeg,image/png"
          multiple
          onChange={() => setTooBig(false)}
        />
        <span className="small muted">{t.appFileHint}</span>
      </label>
      <label className="field">
        {t.statements}
        <input
          type="file"
          name="statements"
          accept="application/pdf,image/jpeg,image/png"
          multiple
          onChange={() => setTooBig(false)}
        />
        <span className="small muted">
          {t.statementsHint} {t.sizeHint}
        </span>
      </label>
      {tooBig ? (
        <p className="notice error" role="alert">
          {t.tooBig}
        </p>
      ) : null}
      <p>
        <Submit idle={t.start} busy={t.busy} />
      </p>
      <p className="small muted">{t.privacy}</p>
    </form>
  );
}
