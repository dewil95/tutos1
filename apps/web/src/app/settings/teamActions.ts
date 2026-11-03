"use server";

import { getPrisma, type UserRole } from "@mca/db";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { allowedEmailDomain } from "@/server/env";

const ROLES: UserRole[] = ["ADMIN", "MANAGER", "CLOSER", "OPENER", "PROCESSOR", "READ_ONLY"];

const back = (params: Record<string, string>) => `/settings?${new URLSearchParams(params)}`;

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "MANAGER") redirect("/settings");
  return user;
}

/**
 * Gives a teammate access to the CRM: an active User row on the company domain. They then sign
 * in with that Google account. Someone added before and switched off is switched back on.
 */
export async function addTeamMember(form: FormData) {
  const user = await requireAdmin();
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const name = String(form.get("name") ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const role = String(form.get("role") ?? "") as UserRole;
  const domain = allowedEmailDomain();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !email.endsWith(`@${domain}`)) {
    redirect(back({ error: `The email must be on @${domain}.` }));
  }
  if (!name) redirect(back({ error: "Type the teammate's name." }));
  if (!ROLES.includes(role)) redirect(back({ error: "Pick a role." }));
  await getPrisma().user.upsert({
    where: { tenantId_email: { tenantId: user.tenantId, email } },
    create: { tenantId: user.tenantId, email, name, role, isActive: true },
    update: { name, role, isActive: true },
  });
  redirect(back({ team: `${email} can sign in now.` }));
}

/** Switches a teammate's access off (they keep their history) or back on. */
export async function setTeamMemberActive(form: FormData) {
  const user = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const active = form.get("active") === "on";
  if (id === user.id && !active) redirect(back({ error: "You cannot switch yourself off." }));
  const prisma = getPrisma();
  const member = await prisma.user.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!member) redirect(back({ error: "Teammate not found." }));
  await prisma.user.update({ where: { id: member.id }, data: { isActive: active } });
  redirect(back({ team: `${member.email} is ${active ? "on" : "off"}.` }));
}
