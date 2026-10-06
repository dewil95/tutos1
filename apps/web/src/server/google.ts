import {
  DriveProvider,
  GmailProvider,
  GoogleAuth,
  dealFolderPath,
  DEAL_SUBFOLDERS,
} from "@mca/connectors";
import type { DealSubfolder } from "@mca/connectors";
import { decryptSecret, type MailboxConnection, type PrismaClient } from "@mca/db";
import { requireEnv } from "./env";

export interface Mailbox {
  connection: MailboxConnection;
  gmail: GmailProvider;
  drive: DriveProvider;
}

export class MailboxNotConnectedError extends Error {
  constructor() {
    super("No Gmail mailbox connected. An admin must connect it in Settings.");
    this.name = "MailboxNotConnectedError";
  }
}

/** The tenant's connected sending mailbox (funding@…) with Gmail + Drive clients. */
export async function tenantMailbox(prisma: PrismaClient, tenantId: string): Promise<Mailbox> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const connections = await prisma.mailboxConnection.findMany({
    where: { tenantId },
    orderBy: { connectedAt: "desc" },
  });
  const connection =
    connections.find((c) => c.email === tenant.fromAddress?.toLowerCase()) ?? connections[0];
  if (!connection) throw new MailboxNotConnectedError();
  return mailboxFor(connection);
}

export function mailboxFor(connection: MailboxConnection): Mailbox {
  const auth = new GoogleAuth(
    { clientId: requireEnv("GOOGLE_CLIENT_ID"), clientSecret: requireEnv("GOOGLE_CLIENT_SECRET") },
    decryptSecret(connection.encryptedRefreshToken, requireEnv("PII_ENCRYPTION_KEY")),
  );
  return { connection, gmail: new GmailProvider(auth), drive: new DriveProvider(auth) };
}

/** Creates (once) the deal's Drive folder and its subfolders; stores the id on the deal. */
export async function ensureDealFolder(
  prisma: PrismaClient,
  mailbox: Mailbox,
  dealId: string,
): Promise<string> {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: { merchant: { select: { legalName: true, dba: true } } },
  });
  if (deal.driveFolderId) return deal.driveFolderId;
  const folderId = await mailbox.drive.ensureFolderPath(
    dealFolderPath(deal.merchant.dba ?? deal.merchant.legalName, deal.id),
  );
  for (const sub of DEAL_SUBFOLDERS) await mailbox.drive.ensureFolderPath([sub], folderId);
  await prisma.deal.update({ where: { id: dealId }, data: { driveFolderId: folderId } });
  return folderId;
}

export async function dealSubfolder(
  mailbox: Mailbox,
  dealFolderId: string,
  sub: DealSubfolder,
): Promise<string> {
  return mailbox.drive.ensureFolderPath([sub], dealFolderId);
}
