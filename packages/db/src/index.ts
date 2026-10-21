import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/client";

export * from "./generated/client";
export { purgeTenant } from "./tenant";
export * from "./jobs";
export * from "./crypto";
export * from "./funderCsv";
export * from "./lookup";

/** Where the database file lives on the server unless DATABASE_PATH says otherwise. */
export const DEFAULT_DATABASE_PATH = "/var/lib/ascend-crm/crm.db";

let resolvePath: (() => string) | null = null;
const clients = new Map<string, PrismaClient>();

/** Points the app at another database file (tests use a temporary one). */
export function setDatabasePath(fn: () => string): void {
  resolvePath = fn;
}

export function databasePath(): string {
  return resolvePath?.() ?? process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
}

/**
 * Prisma client on the server's SQLite file (one per file, reused by every request). The file
 * is in WAL mode (set by the migration runner), so readers never wait for the writer. Code
 * still writes in order rather than in interactive transactions, and every rule that must not
 * break (one claim per job, append-only history) is a single conditional statement or a
 * database trigger.
 */
export function getPrisma(): PrismaClient {
  const path = databasePath();
  let client = clients.get(path);
  if (!client) {
    client = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: `file:${path}`, timeout: 10_000 }),
    });
    clients.set(path, client);
  }
  return client;
}
export * from "./seed";
