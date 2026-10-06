import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export * from "./generated/client";
export { purgeTenant, withTenant } from "./tenant";
export * from "./jobs";
export * from "./crypto";
export * from "./funderCsv";

const globalForPrisma = globalThis as unknown as { __mcaPrisma?: PrismaClient };

/**
 * Process-wide Prisma client (pg driver adapter, required by Prisma 7). On Vercel the module can
 * be re-evaluated per request in dev; caching on globalThis avoids exhausting Supabase's pooler.
 * DATABASE_URL must be the Supabase pooler string (port 6543) in production.
 */
export function getPrisma(): PrismaClient {
  if (globalForPrisma.__mcaPrisma) return globalForPrisma.__mcaPrisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString, max: Number(process.env.DB_POOL_MAX ?? 3) });
  globalForPrisma.__mcaPrisma = new PrismaClient({ adapter });
  return globalForPrisma.__mcaPrisma;
}
