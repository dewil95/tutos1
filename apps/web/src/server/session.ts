import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";

/**
 * Sign-in without Cloudflare Access ("Sign in with Google" on /login): Google proves who the
 * person is, then the CRM keeps them signed in with its own session cookie, an HS256 JWT signed
 * with SESSION_SECRET. Only the email and Google's user id go in it; whether that person may use
 * the CRM is still checked against the team list on every request (see auth.ts).
 */
export const SESSION_COOKIE = "crm_session";
/** Holds the state and nonce of a sign-in in progress, only for /api/auth. */
export const LOGIN_COOKIE = "crm_login";
export const SESSION_HOURS = 12;

const ISSUER = "ascend-crm";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";

export interface SessionIdentity {
  email: string;
  sub: string;
}

/** SESSION_SECRET as a signing key, or null when this sign-in isn't set up (too short = unset). */
export function sessionKey(secret = process.env.SESSION_SECRET): Uint8Array | null {
  return secret && secret.length >= 32 ? new TextEncoder().encode(secret) : null;
}

export function googleSignInEnabled(): boolean {
  return sessionKey() !== null;
}

export async function createSessionToken(
  id: SessionIdentity,
  key: Uint8Array,
  hours = SESSION_HOURS,
): Promise<string> {
  return new SignJWT({ email: id.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setSubject(id.sub)
    .setIssuedAt()
    .setExpirationTime(`${hours}h`)
    .sign(key);
}

export async function verifySessionToken(
  token: string | null | undefined,
  key: Uint8Array | null,
): Promise<SessionIdentity | null> {
  if (!token || !key) return null;
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: ISSUER,
      audience: ISSUER,
      algorithms: ["HS256"],
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    if (!email || !payload.sub) return null;
    return { email, sub: payload.sub };
  } catch {
    return null;
  }
}

/** Google's consent screen for sign-in only: name and email, nothing from Gmail or Drive. */
export function googleSignInUrl(
  cfg: { clientId: string; redirectUri: string },
  state: string,
  nonce: string,
  hostedDomain?: string,
): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
    state,
    nonce,
  });
  // Only preselects company accounts on Google's screen; the email is checked after sign-in.
  if (hostedDomain) p.set("hd", hostedDomain);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

let googleKeys: JWTVerifyGetKey | undefined;

/**
 * Checks the id_token from Google's token endpoint: Google's signature, this app's client id,
 * the nonce from this sign-in, and a verified email. `keys` is injectable for tests.
 */
export async function verifyGoogleIdToken(
  idToken: string | null | undefined,
  opts: { clientId: string; nonce: string; keys?: JWTVerifyGetKey },
): Promise<SessionIdentity | null> {
  if (!idToken || !opts.clientId || !opts.nonce) return null;
  const keys = opts.keys ?? (googleKeys ??= createRemoteJWKSet(new URL(GOOGLE_KEYS_URL)));
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      issuer: GOOGLE_ISSUERS,
      audience: opts.clientId,
    });
    if (payload.nonce !== opts.nonce || payload.email_verified !== true) return null;
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    if (!email || !payload.sub) return null;
    return { email, sub: payload.sub };
  } catch {
    return null;
  }
}

/** Where to go after sign-in: only a path on this site, never another site. */
export function safeReturnPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/api/auth") || next.startsWith("/login")) return "/";
  return next;
}
