import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";

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

/**
 * Brings the database file up to date: each `migrations/NNNN_*.sql` not yet recorded in
 * `_migrations` runs once, in order, inside its own transaction. Safe to run on every deploy.
 * Also switches the file to WAL mode (kept by the file) so the app and backups never block.
 */
export function applyMigrations(path: string): string[] {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(
      'CREATE TABLE IF NOT EXISTS "_migrations" ("name" TEXT NOT NULL PRIMARY KEY, "appliedAt" TEXT NOT NULL)',
    );
    const done = new Set(
      (db.prepare('SELECT "name" FROM "_migrations"').all() as { name: string }[]).map(
        (r) => r.name,
      ),
    );
    const applied: string[] = [];
    for (const m of migrationFiles()) {
      if (done.has(m.name)) continue;
      db.transaction(() => {
        for (const stmt of splitSql(m.sql)) db.exec(stmt);
        db.prepare('INSERT INTO "_migrations" ("name", "appliedAt") VALUES (?, ?)').run(
          m.name,
          new Date().toISOString(),
        );
      })();
      applied.push(m.name);
    }
    return applied;
  } finally {
    db.close();
  }
}

// CLI: `pnpm db:migrate` (DATABASE_PATH or the default server path).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.env.DATABASE_PATH ?? "/var/lib/ascend-crm/crm.db";
  const applied = applyMigrations(path);
  console.log(
    applied.length ? `Applied ${applied.join(", ")} to ${path}` : `${path} is up to date`,
  );
}
