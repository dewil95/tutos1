"use server";

import { getPrisma } from "@mca/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { runChatNow } from "@/server/whatsapp/chat";
import { submitSecureForm } from "@/server/whatsapp/secureForm";

export async function saveSecureDetails(token: string, form: FormData) {
  const prisma = getPrisma();
  const result = await submitSecureForm(prisma, token, {
    ssn: String(form.get("ssn") ?? ""),
    dob: String(form.get("dob") ?? ""),
  });
  if (!result.ok) redirect(`/apply/${encodeURIComponent(token)}?error=${result.error}`);
  // The chat continues on WhatsApp right away (review and signature).
  after(() => runChatNow(prisma, []));
  redirect(`/apply/${encodeURIComponent(token)}?done=1`);
}
