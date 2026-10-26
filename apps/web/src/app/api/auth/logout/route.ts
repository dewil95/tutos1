import { cookies } from "next/headers";
import { appUrl } from "@/server/env";
import { SESSION_COOKIE } from "@/server/session";

/** Ends the CRM session; Google stays signed in, so the next sign-in offers the account picker. */
export async function GET(req: Request) {
  (await cookies()).delete({ name: SESSION_COOKIE, path: "/" });
  return Response.redirect(`${appUrl(req)}/login?signed_out=1`);
}
