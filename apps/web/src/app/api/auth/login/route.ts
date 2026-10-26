import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { allowedEmailDomain, appUrl, requireEnv } from "@/server/env";
import {
  googleSignInEnabled,
  googleSignInUrl,
  LOGIN_COOKIE,
  safeReturnPath,
} from "@/server/session";

/** "Sign in with Google": sends the person to Google, remembering where they were going. */
export async function GET(req: Request) {
  const base = appUrl(req);
  if (!googleSignInEnabled()) return Response.redirect(`${base}/login?error=not_configured`);
  const next = safeReturnPath(new URL(req.url).searchParams.get("next"));
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  (await cookies()).set(LOGIN_COOKIE, `${state}.${nonce}.${encodeURIComponent(next)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 600,
  });
  return Response.redirect(
    googleSignInUrl(
      { clientId: requireEnv("GOOGLE_CLIENT_ID"), redirectUri: `${base}/api/auth/callback` },
      state,
      nonce,
      allowedEmailDomain(),
    ),
  );
}
