import { randomBytes } from "node:crypto";
import { GOOGLE_HISTORY_SCOPES, googleConsentUrl } from "@mca/connectors";
import { getPrisma } from "@mca/db";
import { cookies } from "next/headers";
import { userOrResponse } from "@/server/auth";
import { googleOAuthConfig } from "@/server/env";

/**
 * Admin connects the shared sending mailbox (funding@…) for Gmail + Drive access, or with
 * ?purpose=history a team mailbox the CRM only reads to learn from past deals.
 */
export async function GET(req: Request) {
  const user = await userOrResponse({ admin: true });
  if (user instanceof Response) return user;
  const history = new URL(req.url).searchParams.get("purpose") === "history";
  const tenant = await getPrisma().tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  // The purpose rides in the state so the callback knows which kind of mailbox this is.
  const state = `${history ? "h" : "s"}.${randomBytes(24).toString("base64url")}`;
  (await cookies()).set("g_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return Response.redirect(
    history
      ? googleConsentUrl(googleOAuthConfig(req), state, undefined, GOOGLE_HISTORY_SCOPES)
      : googleConsentUrl(googleOAuthConfig(req), state, tenant.fromAddress ?? undefined),
  );
}
