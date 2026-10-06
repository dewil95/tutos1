import pg from "pg";

/** True when DATABASE_URL points at a migrated Postgres (local cluster or the CI service). */
export async function databaseReady(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    return Boolean((await c.query(`select to_regclass('public."ApiKey"') as t`)).rows[0]?.t);
  } catch {
    return false;
  } finally {
    await c.end().catch(() => undefined);
  }
}
