import { appUrl } from "@/server/env";
import { supabaseServer } from "@/server/auth";

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return Response.redirect(`${appUrl(req)}/login`, 303);
}
