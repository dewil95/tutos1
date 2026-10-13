import { getPrisma, type User } from "@mca/db";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { allowedEmailDomain } from "./env";

/**
 * Sign-in is Cloudflare Access: Cloudflare shows the Google login before any request reaches
 * the CRM and allows only @ascendfund.co accounts. Every request then carries a signed JWT in
 * `Cf-Access-Jwt-Assertion`; we verify it (team keys, issuer, audience) instead of trusting the
 * email header, so a request that bypassed Access gets nothing.
 *
 * Settings: CF_ACCESS_TEAM_DOMAIN (e.g. "ascendfund.cloudflareaccess.com") and CF_ACCESS_AUD
 * (the Access application's "Application Audience (AUD) Tag").
 */
export function isAllowedEmail(email: string | null | undefined): email is string {
  return !!email && email.toLowerCase().endsWith(`@${allowedEmailDomain()}`);
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

export interface AccessIdentity {
  email: string;
  sub: string;
}

/** Verifies the Access JWT. `keys` is injectable for tests. */
export async function verifyAccessJwt(
  token: string | null | undefined,
  opts: { teamDomain?: string; audience?: string; keys?: JWTVerifyGetKey } = {},
): Promise<AccessIdentity | null> {
  const teamDomain = (opts.teamDomain ?? process.env.CF_ACCESS_TEAM_DOMAIN ?? "").replace(
    /^https?:\/\//,
    "",
  );
  const audience = opts.audience ?? process.env.CF_ACCESS_AUD;
  if (!token || !teamDomain || !audience) return null;
  let keys = opts.keys ?? jwksCache.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, keys);
  }
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: `https://${teamDomain}`,
      audience,
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    if (!email || !payload.sub) return null;
    return { email, sub: payload.sub };
  } catch {
    return null;
  }
}

/** Local development only (`next dev`): act as DEV_USER_EMAIL without Cloudflare Access. */
function devIdentity(): AccessIdentity | null {
  const email = process.env.DEV_USER_EMAIL?.toLowerCase();
  return process.env.NODE_ENV === "development" && email ? { email, sub: `dev:${email}` } : null;
}

/** The verified Google identity Cloudflare Access let through (any email), or null. */
export async function currentIdentity(): Promise<AccessIdentity | null> {
  const h = await headers();
  return (await verifyAccessJwt(h.get("cf-access-jwt-assertion"))) ?? devIdentity();
}

/** The signed-in CRM user (an active User row with an allowed email), or null. */
export async function currentUser(): Promise<User | null> {
  const id = await currentIdentity();
  if (!id || !isAllowedEmail(id.email)) return null;
  const prisma = getPrisma();
  const user = await prisma.user.findFirst({ where: { email: id.email, isActive: true } });
  if (!user) return null;
  if (user.authUserId !== id.sub) {
    return prisma.user.update({ where: { id: user.id }, data: { authUserId: id.sub } });
  }
  return user;
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/no-access");
  return user;
}

/** For route handlers: returns a 401/403 Response instead of redirecting. */
export async function userOrResponse(opts: { admin?: boolean } = {}): Promise<User | Response> {
  const user = await currentUser();
  if (!user) return Response.json({ error: "not signed in" }, { status: 401 });
  if (opts.admin && user.role !== "ADMIN" && user.role !== "MANAGER") {
    return Response.json({ error: "admin only" }, { status: 403 });
  }
  return user;
}

/** Cloudflare Access ends the session here. */
export const SIGN_OUT_URL = "/cdn-cgi/access/logout";
