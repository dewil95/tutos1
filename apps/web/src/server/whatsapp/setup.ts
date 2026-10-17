import {
  registerWhatsAppNumber,
  subscribeWhatsAppWebhooks,
  whatsappNumberInfo,
  whatsappSubscribedApps,
  type WhatsAppSetupConfig,
} from "@mca/connectors";
import { whatsappSettings } from "./config";

/**
 * The three one-time WhatsApp steps behind the Settings buttons, so nobody needs curl.
 * Each returns one plain sentence for the Settings page; errors carry Meta's own message.
 */
export type SetupStep = "check" | "register" | "webhooks";

export function setupConfig(): WhatsAppSetupConfig {
  const s = whatsappSettings();
  const missing = [
    ...(s.token ? [] : ["WHATSAPP_TOKEN"]),
    ...(s.phoneNumberId ? [] : ["WHATSAPP_PHONE_NUMBER_ID"]),
  ];
  if (missing.length)
    throw new Error(
      `Set ${missing.join(" and ")} in the server settings file (/etc/ascend-crm/env), then restart the CRM.`,
    );
  return {
    token: s.token,
    phoneNumberId: s.phoneNumberId,
    businessAccountId: s.businessAccountId || undefined,
    graphVersion: s.graphVersion,
  };
}

export async function runWhatsAppSetup(
  step: SetupStep,
  opts: { pin?: string; cfg?: WhatsAppSetupConfig } = {},
): Promise<string> {
  const cfg = opts.cfg ?? setupConfig();
  if (step === "check") {
    const n = await whatsappNumberInfo(cfg);
    const parts = [
      `Connected to ${n.displayPhoneNumber ?? "the number"}`,
      `name "${n.verifiedName ?? "?"}" (${(n.nameStatus ?? "unknown").toLowerCase().replace(/_/g, " ")})`,
      `code ${(n.codeVerificationStatus ?? "unknown").toLowerCase().replace(/_/g, " ")}`,
      ...(n.qualityRating ? [`quality ${n.qualityRating.toLowerCase()}`] : []),
    ];
    let webhooks = "";
    if (cfg.businessAccountId) {
      const apps = await whatsappSubscribedApps(cfg);
      webhooks = apps.length
        ? ` Webhooks go to: ${apps.join(", ")}.`
        : " No app is subscribed to webhooks yet: press Connect webhooks.";
    }
    return `${parts.join(", ")}.${webhooks}`;
  }
  if (step === "register") {
    await registerWhatsAppNumber(cfg, (opts.pin ?? "").trim());
    return "Number registered. Keep the PIN: it is now the number's two-step verification PIN.";
  }
  await subscribeWhatsAppWebhooks(cfg);
  return "Webhooks connected: merchant messages will now reach the CRM.";
}
