import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { isAllowedEmail, verifyAccessJwt } from "./auth";

const TEAM = "ascendfund.cloudflareaccess.com";
const AUD = "aud-tag-123";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (
    claims: Record<string, unknown>,
    opts: { iss?: string; aud?: string; exp?: string } = {},
  ) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? `https://${TEAM}`)
      .setAudience(opts.aud ?? AUD)
      .setSubject("user-1")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "1h")
      .sign(privateKey);
  return { keys, sign };
}

describe("Cloudflare Access sign-in", () => {
  it("accepts a token Access signed for this app and returns the email", async () => {
    const { keys, sign } = await setup();
    const token = await sign({ email: "Jonas@AscendFund.co" });
    expect(await verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD, keys })).toEqual({
      email: "jonas@ascendfund.co",
      sub: "user-1",
    });
  });

  it("rejects other apps, other teams, expired and forged tokens", async () => {
    const { keys, sign } = await setup();
    const other = await setup();
    const cfg = { teamDomain: TEAM, audience: AUD, keys };
    expect(
      await verifyAccessJwt(await sign({ email: "a@ascendfund.co" }, { aud: "other" }), cfg),
    ).toBeNull();
    expect(
      await verifyAccessJwt(
        await sign({ email: "a@ascendfund.co" }, { iss: "https://evil.cloudflareaccess.com" }),
        cfg,
      ),
    ).toBeNull();
    expect(
      await verifyAccessJwt(await sign({ email: "a@ascendfund.co" }, { exp: "-1m" }), cfg),
    ).toBeNull();
    expect(await verifyAccessJwt(await other.sign({ email: "a@ascendfund.co" }), cfg)).toBeNull();
    expect(await verifyAccessJwt(null, cfg)).toBeNull();
    expect(await verifyAccessJwt("not-a-jwt", cfg)).toBeNull();
  });

  it("needs the Access settings and the company domain", async () => {
    const { keys, sign } = await setup();
    const token = await sign({ email: "a@ascendfund.co" });
    expect(await verifyAccessJwt(token, { teamDomain: "", audience: AUD, keys })).toBeNull();
    expect(isAllowedEmail("a@ascendfund.co")).toBe(true);
    expect(isAllowedEmail("a@gmail.com")).toBe(false);
    expect(isAllowedEmail("a@ascendfund.co.evil.com")).toBe(false);
  });
});
