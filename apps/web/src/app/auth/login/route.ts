import { allowedEmailDomain, appUrl } from "@/server/env";
import { supabaseServer } from "@/server/auth";

/** Starts Google sign-in through Supabase Auth, limited to the Workspace domain. */
export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${appUrl(req)}/auth/callback`,
      queryParams: { hd: allowedEmailDomain(), prompt: "select_account" },
    },
  });
  if (error || !data.url) {
    return Response.redirect(
      `${appUrl(req)}/login?error=${encodeURIComponent(error?.message ?? "oauth")}`,
    );
  }
  return Response.redirect(data.url);
}
