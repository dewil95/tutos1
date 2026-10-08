import { createWhatsAppClient, type WhatsAppClient } from "@mca/connectors";
import type { PrismaClient } from "@mca/db";

/** WhatsApp Cloud API settings (README "WhatsApp"). */
export function whatsappSettings() {
  return {
    /** Replies are only really sent when WHATSAPP_ENABLED is "true" (dry run otherwise). */
    enabled: process.env.WHATSAPP_ENABLED === "true",
    token: process.env.WHATSAPP_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION || undefined,
  };
}

/** The webhook can receive messages once the number and app secret are set. */
export const whatsappConfigured = () => {
  const s = whatsappSettings();
  return Boolean(s.phoneNumberId && s.appSecret);
};

/** Client for downloads (works in dry run too) or null when no token is set. */
export function whatsappClient(): WhatsAppClient | null {
  const s = whatsappSettings();
  if (!s.token || !s.phoneNumberId) return null;
  return createWhatsAppClient({
    token: s.token,
    phoneNumberId: s.phoneNumberId,
    graphVersion: s.graphVersion,
  });
}

/** Tenant the WhatsApp number belongs to: TENANT_SLUG, or the only tenant. */
export async function whatsappTenantId(prisma: PrismaClient): Promise<string | null> {
  const slug = process.env.TENANT_SLUG;
  if (slug) return (await prisma.tenant.findUnique({ where: { slug } }))?.id ?? null;
  const tenants = await prisma.tenant.findMany({ select: { id: true }, take: 2 });
  return tenants.length === 1 ? tenants[0]!.id : null;
}
