import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { setD1Resolver, type D1Binding } from "./index";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

/** Statements of a migration file. Triggers are written on one line, so ";\n" separates them. */
export function splitSql(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) =>
      s
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

export function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));
}

let shared: Promise<D1Binding> | null = null;

/**
 * A local Cloudflare D1 database (Miniflare, the same engine as production) with every
 * migration applied, registered as the app's database. One per test process.
 */
export function useTestDatabase(): Promise<D1Binding> {
  shared ??= (async () => {
    const mf = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: ["DB"],
    });
    const db = (await mf.getD1Database("DB")) as unknown as D1Binding & {
      prepare(sql: string): unknown;
      batch(stmts: unknown[]): Promise<unknown>;
    };
    for (const m of migrationFiles()) {
      await db.batch(splitSql(m.sql).map((s) => db.prepare(s)));
    }
    setD1Resolver(() => db);
    return db;
  })();
  return shared;
}
