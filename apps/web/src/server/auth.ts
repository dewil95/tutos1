import { createServerClient } from "@supabase/ssr";
import { getPrisma, type User } from "@mca/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { allowedEmailDomain, requireEnv } from "./env";

/** Supabase client bound to the request cookies (Server Components, Route Handlers, Actions). */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const c of list) store.set(c.name, c.value, c.options);
          } catch {
            // Server Components cannot set cookies; proxy.ts refreshes the session instead.
          }
        },
      },
    },
  );
}

export function isAllowedEmail(email: string | null | undefined): email is string {
  return !!email && email.toLowerCase().endsWith(`@${allowedEmailDomain()}`);
}

/**
 * The signed-in CRM user, or null. Identity comes from the verified Supabase JWT (getClaims),
 * then maps to our User row by auth id or email. Only the allowed Workspace domain gets in.
 */
export async function currentUser(): Promise<User | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const email = typeof claims?.email === "string" ? claims.email.toLowerCase() : null;
  if (!claims?.sub || !isAllowedEmail(email)) return null;
  const prisma = getPrisma();
  const byAuth = await prisma.user.findUnique({ where: { authUserId: claims.sub } });
  if (byAuth) return byAuth.isActive ? byAuth : null;
  const byEmail = await prisma.user.findFirst({ where: { email, isActive: true } });
  if (!byEmail) return null;
  return prisma.user.update({ where: { id: byEmail.id }, data: { authUserId: claims.sub } });
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
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
