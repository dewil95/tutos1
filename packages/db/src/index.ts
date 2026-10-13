import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "./generated/client";

export * from "./generated/client";
export { purgeTenant } from "./tenant";
export * from "./jobs";
export * from "./crypto";
export * from "./funderCsv";
export * from "./lookup";

/** The Cloudflare D1 binding (`env.DB`), typed loosely so this package needs no Workers types. */
export type D1Binding = ConstructorParameters<typeof PrismaD1>[0];

let resolveD1: (() => D1Binding) | null = null;
const clients = new WeakMap<object, PrismaClient>();

/**
 * Tells the package where the D1 database comes from: on Cloudflare the web app registers
 * `() => getCloudflareContext().env.DB`; tests register a local Miniflare D1.
 */
export function setD1Resolver(fn: () => D1Binding): void {
  resolveD1 = fn;
}

/** Prisma client for a given D1 binding (one per binding object, reused across calls). */
export function prismaFor(db: D1Binding): PrismaClient {
  let client = clients.get(db as object);
  if (!client) {
    client = new PrismaClient({ adapter: new PrismaD1(db) });
    clients.set(db as object, client);
  }
  return client;
}

/**
 * Prisma client on Cloudflare D1. D1 has no interactive transactions: code writes in order, and
 * every rule that must not break (one claim per job, append-only history) is enforced by a
 * single conditional statement or a database trigger.
 */
export function getPrisma(): PrismaClient {
  if (resolveD1) return prismaFor(resolveD1());
  // On Cloudflare, @opennextjs/cloudflare keeps the request's bindings under this symbol
  // (what getCloudflareContext() reads); the D1 binding is named DB in wrangler.jsonc.
  const ctx = (globalThis as Record<symbol, { env?: { DB?: D1Binding } } | undefined>)[
    Symbol.for("__cloudflare-context__")
  ];
  if (ctx?.env?.DB) return prismaFor(ctx.env.DB);
  throw new Error("No D1 database: the DB binding is missing (see wrangler.jsonc)");
}
export * from "./seed";
