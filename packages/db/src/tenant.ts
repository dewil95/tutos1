import type { PrismaClient } from "./generated/client";

type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Runs `fn` inside a transaction with the Postgres session variable `app.tenant_id` set, so
 * row-level security policies (see prisma/migrations/README.md) scope every query to the tenant.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  if (!/^[A-Za-z0-9_-]+$/.test(tenantId)) {
    throw new Error("invalid tenantId");
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
    return fn(tx);
  });
}
