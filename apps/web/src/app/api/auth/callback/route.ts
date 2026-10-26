import { exchangeCode } from "@mca/connectors";
import { cookies } from "next/headers";
import { isAllowedEmail } from "@/server/auth";
import { appUrl, requireEnv } from "@/server/env";
import {
  createSessionToken,
  LOGIN_COOKIE,
  SESSION_COOKIE,
  SESSION_HOURS,
  safeReturnPath,
  sessionKey,
  verifyGoogleIdToken,
} from "@/server/session";

/** Google sends the person back here: check the sign-in, then start the CRM session. */
export async function GET(req: Request) {
  const base = appUrl(req);
  const fail = (reason: string) =>
    Response.redirect(`${base}/login?error=${encodeURIComponent(reason)}`);
  const key = sessionKey();
  if (!key) return fail("not_configured");

  const params = new URL(req.url).searchParams;
  const jar = await cookies();
  const saved = jar.get(LOGIN_COOKIE)?.value ?? "";
  jar.delete({ name: LOGIN_COOKIE, path: "/api/auth" });
  const [state, nonce, ...rest] = saved.split(".");
  if (!state || !nonce || params.get("state") !== state) return fail("expired");
  if (params.get("error")) return fail("cancelled");
  const code = params.get("code");
  if (!code) return fail("expired");

  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const cfg = {
    clientId,
    clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri: `${base}/api/auth/callback`,
  };
  let idToken: string | undefined;
  try {
    idToken = (await exchangeCode(cfg, code)).id_token;
  } catch {
    return fail("google");
  }
  const id = await verifyGoogleIdToken(idToken, { clientId, nonce });
  if (!id) return fail("google");
  if (!isAllowedEmail(id.email)) return fail("wrong_account");

  jar.set(SESSION_COOKIE, await createSessionToken(id, key), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return Response.redirect(`${base}${safeReturnPath(decodeURIComponent(rest.join(".")))}`);
}
