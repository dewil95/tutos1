import { randomBytes } from "node:crypto";
import { googleConsentUrl } from "@mca/connectors";
import { getPrisma } from "@mca/db";
import { cookies } from "next/headers";
import { userOrResponse } from "@/server/auth";
import { googleOAuthConfig } from "@/server/env";

/** Admin connects the shared sending mailbox (funding@…) for Gmail + Drive access. */
export async function GET(req: Request) {
  const user = await userOrResponse({ admin: true });
  if (user instanceof Response) return user;
  const tenant = await getPrisma().tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("g_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return Response.redirect(
    googleConsentUrl(googleOAuthConfig(req), state, tenant.fromAddress ?? undefined),
  );
}
