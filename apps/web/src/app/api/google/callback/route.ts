import { exchangeCode, GOOGLE_SCOPES } from "@mca/connectors";
import { encryptSecret, enqueueJob, getPrisma } from "@mca/db";
import { cookies } from "next/headers";
import { isAllowedEmail, userOrResponse } from "@/server/auth";
import { appUrl, googleOAuthConfig, requireEnv } from "@/server/env";
import { mailboxFor } from "@/server/google";

function emailFromIdToken(idToken: string | undefined): string | null {
  // Received directly from Google's token endpoint over TLS, so the payload can be read as is.
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    email?: string;
  };
  return claims.email?.toLowerCase() ?? null;
}

export async function GET(req: Request) {
  const base = appUrl(req);
  const fail = (reason: string) =>
    Response.redirect(`${base}/settings?error=${encodeURIComponent(reason)}`);
  const user = await userOrResponse({ admin: true });
  if (user instanceof Response) return user;

  const params = new URL(req.url).searchParams;
  const jar = await cookies();
  const expected = jar.get("g_oauth_state")?.value;
  jar.delete({ name: "g_oauth_state", path: "/api/google" });
  if (!expected || params.get("state") !== expected) return fail("state_mismatch");
  if (params.get("error")) return fail(params.get("error")!);
  const code = params.get("code");
  if (!code) return fail("missing_code");

  const token = await exchangeCode(googleOAuthConfig(req), code);
  const email = emailFromIdToken(token.id_token);
  if (!isAllowedEmail(email)) return fail("wrong_account");
  const granted = (token.scope ?? "").split(" ");
  const missing = GOOGLE_SCOPES.filter((s) => s.startsWith("https://") && !granted.includes(s));
  if (missing.length) return fail("missing_permissions");
  if (!token.refresh_token) return fail("no_refresh_token");

  const prisma = getPrisma();
  const data = {
    encryptedRefreshToken: encryptSecret(token.refresh_token, requireEnv("PII_ENCRYPTION_KEY")),
    scopes: granted,
    connectedById: user.id,
  };
  const connection = await prisma.mailboxConnection.upsert({
    where: { tenantId_email: { tenantId: user.tenantId, email } },
    update: data,
    create: { ...data, tenantId: user.tenantId, email },
  });
  const rootId = await mailboxFor(connection).drive.ensureFolderPath(["Ascend CRM", "Deals"]);
  await prisma.mailboxConnection.update({
    where: { id: connection.id },
    data: { driveRootFolderId: rootId },
  });
  await enqueueJob(prisma, {
    tenantId: user.tenantId,
    type: "INBOX_SYNC",
    payload: { mailboxId: connection.id },
    dedupeKey: `sync:${connection.id}`,
  });
  return Response.redirect(`${base}/settings?connected=${encodeURIComponent(email)}`);
}
