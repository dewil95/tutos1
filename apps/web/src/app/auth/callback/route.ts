import { appUrl } from "@/server/env";
import { currentUser, supabaseServer } from "@/server/auth";

export async function GET(req: Request) {
  const base = appUrl(req);
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return Response.redirect(`${base}/login?error=missing_code`);
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return Response.redirect(`${base}/login?error=${encodeURIComponent(error.message)}`);

  // `hd` is only a hint to Google; enforce the domain and the team list here.
  if (!(await currentUser())) {
    await supabase.auth.signOut();
    return Response.redirect(`${base}/login?error=not_allowed`);
  }
  return Response.redirect(`${base}/`);
}
