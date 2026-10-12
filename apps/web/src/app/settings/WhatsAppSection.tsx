import { getPrisma, type Prisma } from "@mca/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { DEFAULT_CONSENT } from "@/server/whatsapp/copy";
import { whatsappConfigured, whatsappSettings } from "@/server/whatsapp/config";
import { whatsappSetupStep } from "./whatsappSetupActions";

interface WhatsAppTenantSettings {
  /** Ascend's WhatsApp number as merchants see it, digits with country code. */
  number?: string;
  consentEn?: string;
  consentEs?: string;
}

async function saveWhatsApp(form: FormData) {
  "use server";
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "MANAGER") return;
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  const settings = (tenant.settings ?? {}) as Record<string, unknown>;
  const whatsapp: WhatsAppTenantSettings = {
    number:
      String(form.get("number") ?? "")
        .replace(/\D/g, "")
        .slice(0, 15) || undefined,
    consentEn:
      String(form.get("consentEn") ?? "")
        .trim()
        .slice(0, 4000) || undefined,
    consentEs:
      String(form.get("consentEs") ?? "")
        .trim()
        .slice(0, 4000) || undefined,
  };
  await prisma.tenant.update({
    where: { id: user.tenantId },
    data: {
      settings: JSON.parse(JSON.stringify({ ...settings, whatsapp })) as Prisma.InputJsonObject,
    },
  });
  revalidatePath("/settings");
}

/** WhatsApp applications: connection status, the link for the website, signature wording. */
export async function WhatsAppSection({
  tenantId,
  canEdit,
  flash,
}: {
  tenantId: string;
  canEdit: boolean;
  /** Result of the last setup button (from the redirect). */
  flash?: { ok?: string; error?: string };
}) {
  const tenant = await getPrisma().tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const wa = ((tenant.settings ?? {}) as { whatsapp?: WhatsAppTenantSettings }).whatsapp ?? {};
  const s = whatsappSettings();
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const link = wa.number ? `https://wa.me/${wa.number}?text=${encodeURIComponent("Apply")}` : null;
  return (
    <section className="panel" id="whatsapp">
      <h2>WhatsApp applications</h2>
      <p className="small muted">
        Merchants send their signed application from another company (or answer questions); the bot
        fills Ascend&apos;s application, asks only what is missing and the merchant signs by typing
        their name. Setup steps: README → WhatsApp.
      </p>
      <ul className="small">
        <li>
          Webhook:{" "}
          {whatsappConfigured() ? (
            <b>connected</b>
          ) : (
            <span className="muted">
              not set up (WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET)
            </span>
          )}{" "}
          · callback URL <code>{appUrl || "<APP_URL>"}/api/whatsapp/webhook</code>
        </li>
        <li>
          Replies:{" "}
          {s.enabled ? (
            <b>sent for real</b>
          ) : (
            <strong>test mode (written to the chat log; set WHATSAPP_ENABLED=true)</strong>
          )}
        </li>
        {link ? (
          <li>
            Button for the website and emails: <a href={link}>{link}</a>
          </li>
        ) : null}
      </ul>
      {flash?.ok ? <p className="notice ok">{flash.ok}</p> : null}
      {flash?.error ? <p className="notice error">{flash.error}</p> : null}
      {canEdit ? (
        <div className="stack" style={{ marginBottom: 16 }}>
          <p className="small muted" style={{ margin: 0 }}>
            One-time setup, in this order, after the Vercel variables are in place:
          </p>
          <div className="row">
            <form action={whatsappSetupStep.bind(null, "check")} className="inline">
              <button type="submit">1. Check connection</button>
            </form>
            <form action={whatsappSetupStep.bind(null, "register")} className="row inline">
              <input
                name="pin"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="6-digit PIN"
                required
                autoComplete="off"
                style={{ width: 120 }}
              />
              <button type="submit">2. Register number</button>
            </form>
            <form action={whatsappSetupStep.bind(null, "webhooks")} className="inline">
              <button type="submit" disabled={!s.businessAccountId}>
                3. Connect webhooks
              </button>
            </form>
          </div>
          {!s.businessAccountId ? (
            <p className="small muted" style={{ margin: 0 }}>
              Step 3 needs WHATSAPP_BUSINESS_ACCOUNT_ID (Meta app → WhatsApp → API Setup).
            </p>
          ) : null}
        </div>
      ) : null}
      {canEdit ? (
        <form action={saveWhatsApp} className="stack">
          <label className="field">
            Ascend WhatsApp number (with country code)
            <input name="number" defaultValue={wa.number ?? ""} placeholder="13055550100" />
          </label>
          <label className="field">
            Signature authorization (English, printed on the signed application)
            <textarea
              name="consentEn"
              rows={5}
              defaultValue={wa.consentEn ?? ""}
              placeholder={DEFAULT_CONSENT.en}
            />
          </label>
          <label className="field">
            Signature authorization (Spanish, shown to Spanish-speaking merchants)
            <textarea
              name="consentEs"
              rows={5}
              defaultValue={wa.consentEs ?? ""}
              placeholder={DEFAULT_CONSENT.es}
            />
          </label>
          <p className="small muted">
            Empty boxes use the default wording shown in grey. Copy the exact authorization from
            Ascend&apos;s current application here.
          </p>
          <button type="submit">Save</button>
        </form>
      ) : null}
    </section>
  );
}
