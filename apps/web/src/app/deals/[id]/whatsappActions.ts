"use server";

import { getPrisma } from "@mca/db";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { addChatEvent, defaultDeps, runChatNow, sendRepReply } from "@/server/whatsapp/chat";

const DAY = 24 * 3_600_000;

async function chatFor(dealId: string) {
  const user = await requireUser();
  const prisma = getPrisma();
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { dealId, tenantId: user.tenantId },
  });
  if (!conv) throw new Error("This deal has no WhatsApp chat.");
  return { prisma, conv };
}

const done = (dealId: string, params: Record<string, string>) => {
  revalidatePath(`/deals/${dealId}`);
  redirect(`/deals/${dealId}?${new URLSearchParams(params).toString()}#whatsapp`);
};

/** A person takes the chat over; the bot stops answering. */
export async function takeOverChat(dealId: string) {
  const { prisma, conv } = await chatFor(dealId);
  const id = await addChatEvent(prisma, conv, "handoff");
  after(() => runChatNow(prisma, [id]));
  done(dealId, { wa: "You have the chat now; the bot stays quiet." });
}

/** Hands the chat back to the bot, which picks up where the application left off. */
export async function resumeBot(dealId: string) {
  const { prisma, conv } = await chatFor(dealId);
  const id = await addChatEvent(prisma, conv, "resume");
  after(() => runChatNow(prisma, [id]));
  done(dealId, { wa: "The bot continues the application." });
}

/** A rep's reply. WhatsApp only allows free text within 24 h of the merchant's last message. */
export async function replyOnWhatsApp(dealId: string, form: FormData) {
  const { prisma, conv } = await chatFor(dealId);
  const text = String(form.get("text") ?? "").trim();
  if (!text) return done(dealId, { error: "Type a message first." });
  if (!conv.lastInboundAt || Date.now() - conv.lastInboundAt.getTime() > DAY) {
    return done(dealId, {
      error: "WhatsApp's 24-hour reply window is closed. Call or email the merchant instead.",
    });
  }
  if (conv.status !== "HANDOFF") await addChatEvent(prisma, conv, "handoff");
  await sendRepReply(prisma, defaultDeps(prisma, conv.tenantId), conv, text.slice(0, 4000));
  after(() => runChatNow(prisma, []));
  done(dealId, { wa: "Reply sent." });
}
