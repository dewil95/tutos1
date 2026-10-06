import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for secrets at rest (Google refresh token, SSN/EIN fields).
 * Key: 32 random bytes, base64, in PII_ENCRYPTION_KEY. Output: "v1.<iv>.<tag>.<ciphertext>".
 */
function key(raw = process.env.PII_ENCRYPTION_KEY): Buffer {
  if (!raw) throw new Error("PII_ENCRYPTION_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("PII_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function encryptSecret(plain: string, rawKey?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    c.getAuthTag().toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

export function decryptSecret(token: string, rawKey?: string): string {
  const [v, iv, tag, ct] = token.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("unrecognised secret format");
  const d = createDecipheriv("aes-256-gcm", key(rawKey), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
