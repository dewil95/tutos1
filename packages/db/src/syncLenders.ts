import { pathToFileURL } from "node:url";
import { getPrisma } from "./index";
import { syncFunders } from "./seed";

/**
 * Brings every tenant's lender directory in line with the roster bundled in the app
 * (docs/funder-appetite-matrix.csv): addresses, minimums, states, positions, industries.
 * Each deploy runs it after the migrations, so a roster change on main reaches the site
 * without anyone pressing "Update lenders from the roster" in Settings. Adds lenders new on
 * the roster; never deletes one.
 */
export async function syncAllTenantLenders(
  prisma = getPrisma(),
): Promise<{ tenant: string; added: number; updated: number }[]> {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  const results = [];
  for (const t of tenants) {
    const r = await syncFunders(prisma, t.id);
    results.push({ tenant: t.slug, ...r });
  }
  return results;
}

// CLI: `pnpm db:sync-lenders` (DATABASE_PATH or the default server path).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await syncAllTenantLenders();
  if (results.length === 0) console.log("No tenants yet; lenders are created at /setup.");
  for (const r of results) {
    console.log(`Lenders of ${r.tenant}: ${r.added} added, ${r.updated} updated from the roster.`);
  }
  await getPrisma().$disconnect();
}
