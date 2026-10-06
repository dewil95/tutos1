import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@mca/db";

const PREFIX = "ak_live_";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** A new key: shown once in Settings, only its hash is stored. */
export function generateApiKey(): { key: string; prefix: string; hashedKey: string } {
  const key = PREFIX + randomBytes(24).toString("base64url");
  return { key, prefix: key.slice(0, PREFIX.length + 4), hashedKey: hashApiKey(key) };
}

export interface ApiCaller {
  tenantId: string;
  keyId: string;
}

export function apiError(status: number, error: string, details?: unknown): Response {
  return Response.json({ error, ...(details ? { details } : {}) }, { status });
}

/** Resolves `Authorization: Bearer ak_live_…` to a tenant, or a 401 response. */
export async function authenticateApi(
  prisma: PrismaClient,
  req: Request,
): Promise<ApiCaller | Response> {
  const header = req.headers.get("authorization") ?? "";
  const key = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!key || !key.startsWith(PREFIX)) return apiError(401, "missing or malformed API key");
  const row = await prisma.apiKey.findUnique({ where: { hashedKey: hashApiKey(key) } });
  if (!row || row.revokedAt) return apiError(401, "invalid or revoked API key");
  // Write at most once a minute per key.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return { tenantId: row.tenantId, keyId: row.id };
}
