"use server";

import { getPrisma } from "@mca/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { generateApiKey } from "@/server/apiKeys";

export interface CreateKeyState {
  key?: string;
  error?: string;
}

const isAdmin = (role: string) => role === "ADMIN" || role === "MANAGER";

/** Returns the new key once; only its hash is stored. */
export async function createApiKey(_prev: CreateKeyState, form: FormData): Promise<CreateKeyState> {
  const user = await requireUser();
  if (!isAdmin(user.role)) return { error: "Only an admin can create API keys." };
  const name = String(form.get("name") ?? "").trim() || "Website";
  const { key, prefix, hashedKey } = generateApiKey();
  await getPrisma().apiKey.create({
    data: { tenantId: user.tenantId, name, prefix, hashedKey, createdById: user.id },
  });
  revalidatePath("/settings");
  return { key };
}

export async function revokeApiKey(form: FormData): Promise<void> {
  const user = await requireUser();
  if (!isAdmin(user.role)) return;
  await getPrisma().apiKey.updateMany({
    where: { id: String(form.get("id")), tenantId: user.tenantId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/settings");
}
