"use client";

import { useState, useTransition, type FormEvent } from "react";
import { saveDetails } from "../actions";
import { ENTITY_LABELS, copyFor } from "../copy";

export interface FormValues {
  business: Record<string, string>;
  advances: string;
  owners: {
    id: string;
    values: Record<string, string>;
    ssnLast4: string | null;
    dobOnFile: boolean;
  }[];
  einLast4: string | null;
}

/**
 * The merchant's application details. Submitted without a page reload so what they typed stays
 * on screen when something needs fixing; on success the server sends them to the review step.
 */
export function DetailsForm({
  token,
  lang,
  values,
}: {
  token: string;
  lang: "en" | "es";
  values: FormValues;
}) {
  const t = copyFor(lang);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const b = values.business;
  // The second owner is optional: none of its fields are required.
  const req = (label: string, i: number) => (i === 0 ? label : label.replace(/ \*$/, ""));

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const result = await saveDetails(token, form);
      if (result?.error) {
        setError(result.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  const text = (name: string, label: string, opts: { type?: string; hint?: string } = {}) => (
    <label className="field">
      {label}
      <input name={name} type={opts.type ?? "text"} defaultValue={b[name] ?? ""} />
      {opts.hint ? <span className="small muted">{opts.hint}</span> : null}
    </label>
  );

  return (
    <form onSubmit={onSubmit} className="stack appform">
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      <fieldset>
        <legend>{t.business}</legend>
        <div className="row">
          {text("legalName", t.legalName)}
          {text("dba", t.dba)}
          <label className="field">
            {t.entityType}
            <select name="entityType" defaultValue={b.entityType ?? ""}>
              <option value="">—</option>
              {ENTITY_LABELS[lang].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="field">
            {t.ein}
            <input
              name="ein"
              inputMode="numeric"
              autoComplete="off"
              placeholder={values.einLast4 ? "" : "12-3456789"}
            />
            {values.einLast4 ? (
              <span className="small muted">{t.einOnFile(values.einLast4)}</span>
            ) : null}
          </label>
          {text("startDate", t.startDate, { type: "date" })}
          {text("industry", t.industry)}
        </div>
        <div className="row">
          {text("line1", t.address)}
          {text("city", t.city)}
          <label className="field narrow">
            {t.state}
            <input name="state" maxLength={2} size={3} defaultValue={b.state ?? ""} />
          </label>
          <label className="field narrow">
            {t.zip}
            <input name="postalCode" size={6} defaultValue={b.postalCode ?? ""} />
          </label>
        </div>
        <div className="row">
          {text("phone", t.bizPhone, { type: "tel" })}
          {text("email", t.bizEmail, { type: "email" })}
          {text("website", t.website)}
        </div>
      </fieldset>

      <fieldset>
        <legend>{t.request}</legend>
        <div className="row">
          <label className="field">
            {t.amount}
            <input name="amount" inputMode="decimal" defaultValue={b.amount ?? ""} />
          </label>
          <label className="field">
            {t.revenue}
            <input
              name="monthlyRevenue"
              inputMode="decimal"
              defaultValue={b.monthlyRevenue ?? ""}
            />
          </label>
          {text("useOfFunds", t.useOfFunds)}
        </div>
        <label className="field">
          {t.advances}
          <textarea name="advances" rows={3} defaultValue={values.advances} />
          <span className="small muted">{t.advancesHint}</span>
        </label>
      </fieldset>

      {values.owners.map((o, i) => (
        <fieldset key={i}>
          <legend>{i === 0 ? t.owner : t.owner2}</legend>
          <input type="hidden" name={`ownerId-${i}`} value={o.id} />
          <div className="row">
            <label className="field">
              {req(t.firstName, i)}
              <input name={`firstName-${i}`} defaultValue={o.values.firstName ?? ""} />
            </label>
            <label className="field">
              {req(t.lastName, i)}
              <input name={`lastName-${i}`} defaultValue={o.values.lastName ?? ""} />
            </label>
            <label className="field narrow">
              {req(t.pct, i)}
              <input
                name={`pct-${i}`}
                inputMode="decimal"
                size={5}
                defaultValue={o.values.pct ?? ""}
              />
            </label>
          </div>
          <div className="row">
            <label className="field">
              {req(t.ssn, i)}
              <input
                name={`ssn-${i}`}
                inputMode="numeric"
                autoComplete="off"
                placeholder={o.ssnLast4 ? "" : "123-45-6789"}
              />
              {o.ssnLast4 ? <span className="small muted">{t.ssnOnFile(o.ssnLast4)}</span> : null}
            </label>
            <label className="field">
              {req(t.dob, i)}
              <input name={`dob-${i}`} type="date" autoComplete="off" />
              {o.dobOnFile ? <span className="small muted">{t.dobOnFile}</span> : null}
            </label>
            <label className="field narrow">
              {t.score}
              <input
                name={`score-${i}`}
                inputMode="numeric"
                size={4}
                defaultValue={o.values.score ?? ""}
              />
            </label>
          </div>
          <div className="row">
            <label className="field">
              {req(t.homeAddress, i)}
              <input name={`line1-${i}`} defaultValue={o.values.line1 ?? ""} />
            </label>
            <label className="field">
              {t.city}
              <input name={`city-${i}`} defaultValue={o.values.city ?? ""} />
            </label>
            <label className="field narrow">
              {t.state}
              <input
                name={`state-${i}`}
                maxLength={2}
                size={3}
                defaultValue={o.values.state ?? ""}
              />
            </label>
            <label className="field narrow">
              {t.zip}
              <input name={`postalCode-${i}`} size={6} defaultValue={o.values.postalCode ?? ""} />
            </label>
          </div>
          <div className="row">
            <label className="field">
              {t.ownerEmail}
              <input name={`email-${i}`} type="email" defaultValue={o.values.email ?? ""} />
            </label>
            <label className="field">
              {t.ownerPhone}
              <input name={`phone-${i}`} type="tel" defaultValue={o.values.phone ?? ""} />
            </label>
          </div>
        </fieldset>
      ))}

      <p>
        <button type="submit" className="button primary" disabled={pending}>
          {pending ? t.busy : t.save}
        </button>{" "}
        <span className="small muted">{t.encrypted}</span>
      </p>
    </form>
  );
}
