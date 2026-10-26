import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  googleSignInUrl,
  safeReturnPath,
  sessionKey,
  verifyGoogleIdToken,
  verifySessionToken,
} from "./session";

const SECRET = "x".repeat(40);
const CLIENT = "client-123.apps.googleusercontent.com";
const NONCE = "nonce-abc";

describe("CRM session cookie", () => {
  it("round-trips the identity", async () => {
    const key = sessionKey(SECRET)!;
    const token = await createSessionToken({ email: "jonas@ascendfund.co", sub: "g-1" }, key);
    expect(await verifySessionToken(token, key)).toEqual({
      email: "jonas@ascendfund.co",
      sub: "g-1",
    });
  });

  it("rejects other secrets, expired, tampered and empty tokens", async () => {
    const key = sessionKey(SECRET)!;
    const id = { email: "a@ascendfund.co", sub: "g-1" };
    const other = await createSessionToken(id, sessionKey("y".repeat(40))!);
    expect(await verifySessionToken(other, key)).toBeNull();
    expect(await verifySessionToken(await createSessionToken(id, key, -1), key)).toBeNull();
    const [h, , s] = (await createSessionToken(id, key)).split(".");
    const forged = Buffer.from(JSON.stringify({ email: "boss@ascendfund.co", sub: "x" })).toString(
      "base64url",
    );
    expect(await verifySessionToken(`${h}.${forged}.${s}`, key)).toBeNull();
    expect(await verifySessionToken(null, key)).toBeNull();
    expect(await verifySessionToken(await createSessionToken(id, key), null)).toBeNull();
  });

  it("needs a SESSION_SECRET of at least 32 characters", () => {
    expect(sessionKey(undefined)).toBeNull();
    expect(sessionKey("short")).toBeNull();
    expect(sessionKey(SECRET)).not.toBeNull();
  });
});

async function google() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "g1", alg: "RS256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string } = {}) =>
    new SignJWT({ email_verified: true, nonce: NONCE, ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "g1" })
      .setIssuer(opts.iss ?? "https://accounts.google.com")
      .setAudience(opts.aud ?? CLIENT)
      .setSubject("g-1")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  return { keys, sign };
}

describe("Google sign-in token", () => {
  it("accepts Google's token for this app and sign-in", async () => {
    const { keys, sign } = await google();
    const token = await sign({ email: "Jonas@AscendFund.co" });
    expect(await verifyGoogleIdToken(token, { clientId: CLIENT, nonce: NONCE, keys })).toEqual({
      email: "jonas@ascendfund.co",
      sub: "g-1",
    });
  });

  it("rejects other apps, other sign-ins, unverified emails and forged tokens", async () => {
    const { keys, sign } = await google();
    const forger = await google();
    const cfg = { clientId: CLIENT, nonce: NONCE, keys };
    const email = "a@ascendfund.co";
    expect(await verifyGoogleIdToken(await sign({ email }, { aud: "other" }), cfg)).toBeNull();
    expect(
      await verifyGoogleIdToken(await sign({ email }, { iss: "https://evil.example" }), cfg),
    ).toBeNull();
    expect(await verifyGoogleIdToken(await sign({ email, nonce: "other" }), cfg)).toBeNull();
    expect(await verifyGoogleIdToken(await sign({ email, email_verified: false }), cfg)).toBeNull();
    expect(await verifyGoogleIdToken(await forger.sign({ email }), cfg)).toBeNull();
    expect(await verifyGoogleIdToken(undefined, cfg)).toBeNull();
  });
});

describe("sign-in redirects", () => {
  it("only returns to paths on this site", () => {
    expect(safeReturnPath("/deals/42?tab=docs")).toBe("/deals/42?tab=docs");
    expect(safeReturnPath("https://evil.example")).toBe("/");
    expect(safeReturnPath("//evil.example")).toBe("/");
    expect(safeReturnPath("/\\evil.example")).toBe("/");
    expect(safeReturnPath("/login")).toBe("/");
    expect(safeReturnPath(null)).toBe("/");
  });

  it("asks Google for sign-in only, with the nonce and company domain", () => {
    const url = new URL(
      googleSignInUrl(
        { clientId: CLIENT, redirectUri: "https://crm.example/api/auth/callback" },
        "st",
        NONCE,
        "ascendfund.co",
      ),
    );
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("nonce")).toBe(NONCE);
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("hd")).toBe("ascendfund.co");
    expect(url.searchParams.get("access_type")).toBeNull();
  });
});
