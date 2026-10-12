import { getPrisma } from "@mca/db";
import type { Metadata } from "next";
import { findSecureToken } from "@/server/whatsapp/secureForm";
import { saveSecureDetails } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Ascend Fund – secure details",
  robots: { index: false, follow: false },
};

const TEXT = {
  en: {
    title: "Secure details",
    intro: (name: string) =>
      `To finish ${name ? `${name}'s` : "your"} Ascend Fund application, add the owner's Social Security number and date of birth. They are encrypted and only used for this application.`,
    ssn: "Social Security number",
    dob: "Date of birth",
    save: "Save securely",
    done: "Saved ✅ Go back to WhatsApp to review and sign your application.",
    expired: "This link has expired or was already used. Reply *link* on WhatsApp for a new one.",
    errSsn: "Please check the Social Security number (9 digits).",
    errDob: "Please check the date of birth.",
  },
  es: {
    title: "Datos seguros",
    intro: (name: string) =>
      `Para terminar la solicitud de Ascend Fund${name ? ` de ${name}` : ""}, agregue el número de Seguro Social y la fecha de nacimiento del dueño. Se guardan cifrados y solo se usan para esta solicitud.`,
    ssn: "Número de Seguro Social",
    dob: "Fecha de nacimiento",
    save: "Guardar de forma segura",
    done: "Guardado ✅ Vuelva a WhatsApp para revisar y firmar su solicitud.",
    expired: "Este enlace venció o ya se usó. Responda *enlace* en WhatsApp para uno nuevo.",
    errSsn: "Revise el número de Seguro Social (9 dígitos).",
    errDob: "Revise la fecha de nacimiento.",
  },
};

/** One-time page from the WhatsApp chat: SSN and date of birth never go through the chat. */
export default async function SecureDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { token } = await params;
  const { done, error } = await searchParams;
  const row = done ? null : await findSecureToken(getPrisma(), token);
  const t = TEXT[row?.conversation.language === "es" ? "es" : "en"];
  const owner = (row?.conversation.answers as { owners?: { firstName?: string }[] } | undefined)
    ?.owners?.[0]?.firstName;

  return (
    <div className="login-page">
      <section className="login">
        <span className="brand">
          <span className="brand-mark">A</span>
          <span className="brand-name">Ascend Fund</span>
        </span>
        <h1>{t.title}</h1>
        {done ? (
          <p className="notice ok">
            {TEXT.en.done}
            <br />
            {TEXT.es.done}
          </p>
        ) : !row ? (
          <p className="notice error">
            {TEXT.en.expired}
            <br />
            {TEXT.es.expired}
          </p>
        ) : (
          <form action={saveSecureDetails.bind(null, token)} autoComplete="off">
            <p className="muted" style={{ marginTop: 0 }}>
              {t.intro(owner ?? "")}
            </p>
            {error === "ssn" ? <p className="notice error">{t.errSsn}</p> : null}
            {error === "dob" ? <p className="notice error">{t.errDob}</p> : null}
            {error === "expired" ? <p className="notice error">{t.expired}</p> : null}
            <label className="field">
              {t.ssn}
              <input
                name="ssn"
                inputMode="numeric"
                pattern="\d{3}-?\d{2}-?\d{4}"
                placeholder="123-45-6789"
                required
                autoComplete="off"
              />
            </label>
            <label className="field">
              {t.dob}
              <input name="dob" type="date" required />
            </label>
            <button className="button primary" type="submit">
              {t.save}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
