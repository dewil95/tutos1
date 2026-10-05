import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export * from "./generated/client";
export { withTenant } from "./tenant";

let client: PrismaClient | undefined;

/**
 * Process-wide Prisma client. Uses the pg driver adapter required by Prisma 7.
 * DATABASE_URL must be set; fails fast otherwise so misconfiguration is obvious.
 */
export function getPrisma(): PrismaClient {
  if (client) return client;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaPg({ connectionString });
  client = new PrismaClient({ adapter });
  return client;
}
