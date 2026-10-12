"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { runWhatsAppSetup, type SetupStep } from "@/server/whatsapp/setup";

/** Settings buttons: Check connection, Register number, Connect webhooks (admins only). */
export async function whatsappSetupStep(step: SetupStep, form: FormData) {
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "MANAGER") redirect("/settings");
  let params: Record<string, string>;
  try {
    const ok = await runWhatsAppSetup(step, { pin: String(form.get("pin") ?? "") });
    console.log(`[whatsapp setup] ${step}: ${ok}`);
    params = { wa: ok };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[whatsapp setup] ${step} failed: ${msg}`);
    params = { waError: msg };
  }
  redirect(`/settings?${new URLSearchParams(params).toString()}#whatsapp`);
}
