import { createHash, randomBytes } from "node:crypto";
import { encryptSecret, enqueueJob, type PrismaClient } from "@mca/db";
import { requireEnv } from "../env";
import { validSsn } from "./questions";

const DAY = 24 * 3_600_000;
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** One-time link for SSN + date of birth (24 h). Only the hash is stored. */
export async function createSecureToken(
  prisma: PrismaClient,
  conv: { id: string; tenantId: string },
  now: Date,
): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await prisma.secureFormToken.create({
    data: {
      tenantId: conv.tenantId,
      conversationId: conv.id,
      hashedToken: hashToken(token),
      expiresAt: new Date(now.getTime() + DAY),
    },
  });
  return token;
}

/** The token's conversation if the link is still valid (unused, not expired). */
export async function findSecureToken(prisma: PrismaClient, token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const row = await prisma.secureFormToken.findUnique({
    where: { hashedToken: hashToken(token) },
    include: { conversation: true },
  });
  if (!row || row.usedAt || row.expiresAt <= now) return null;
  return row;
}

export type SecureFormResult = { ok: true } | { ok: false; error: "expired" | "ssn" | "dob" };

/**
 * Saves the owner's SSN and date of birth from the private page. They are encrypted at once
 * and handed to the chat as an event; the chat job is the only writer of conversation state.
 */
export async function submitSecureForm(
  prisma: PrismaClient,
  token: string,
  input: { ssn: string; dob: string },
  now = new Date(),
): Promise<SecureFormResult> {
  const row = await findSecureToken(prisma, token, now);
  if (!row) return { ok: false, error: "expired" };
  const ssn = validSsn(input.ssn);
  if (!ssn) return { ok: false, error: "ssn" };
  const dob = /^\d{4}-\d{2}-\d{2}$/.test(input.dob) ? input.dob : null;
  const age = dob ? (now.getTime() - Date.parse(`${dob}T00:00:00Z`)) / (365.25 * DAY) : 0;
  if (!dob || !(age >= 18 && age <= 110)) return { ok: false, error: "dob" };

  const used = await prisma.secureFormToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: now },
  });
  if (used.count === 0) return { ok: false, error: "expired" };
  await prisma.whatsAppMessage.create({
    data: {
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      direction: "event",
      kind: "secure_done",
      text: encryptSecret(JSON.stringify({ ssn, dob }), requireEnv("PII_ENCRYPTION_KEY")),
    },
  });
  await enqueueJob(prisma, {
    tenantId: row.tenantId,
    type: "WHATSAPP_MESSAGE",
    payload: { conversationId: row.conversationId },
    dedupeKey: `wa:${row.conversationId}`,
  });
  return { ok: true };
}
