import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDatabasePath } from "./index";
import { applyMigrations } from "./migrate";

export { migrationFiles, splitSql } from "./migrate";

let shared: string | null = null;

/**
 * A fresh SQLite database file (the same engine as the server) with every migration applied,
 * registered as the app's database. One per test process.
 */
export async function useTestDatabase(): Promise<string> {
  if (!shared) {
    shared = join(mkdtempSync(join(tmpdir(), "ascend-crm-test-")), "crm.db");
    applyMigrations(shared);
    setDatabasePath(() => shared!);
  }
  return shared;
}
