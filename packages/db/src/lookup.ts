import type { PrismaClient } from "./generated/client";

/**
 * Merchants whose legal name (or DBA) equals `name` ignoring letter case. SQLite/D1 has no
 * case-insensitive `equals`, so this compares lower() in SQL; names are ASCII in practice.
 */
export async function merchantIdsByName(
  prisma: PrismaClient,
  tenantId: string,
  name: string,
  opts: { includeDba?: boolean } = {},
): Promise<string[]> {
  const rows = opts.includeDba
    ? await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Merchant" WHERE "tenantId" = ${tenantId}
          AND (lower("legalName") = lower(${name}) OR lower(coalesce("dba", '')) = lower(${name}))
        ORDER BY "createdAt" ASC`
    : await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Merchant" WHERE "tenantId" = ${tenantId}
          AND lower("legalName") = lower(${name})
        ORDER BY "createdAt" ASC`;
  return rows.map((r) => r.id);
}

/** JSON list columns (SQLite has no arrays): read any stored value as a string list. */
export function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
