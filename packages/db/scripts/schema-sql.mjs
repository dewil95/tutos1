#!/usr/bin/env node
/**
 * Prints the SQL that creates the current Prisma schema on SQLite/D1 (used to write
 * migrations/0001_init.sql, and by a test that checks the migrations still match the schema).
 * Prisma emits JSON defaults unquoted (`DEFAULT []`), which SQLite rejects; this quotes them.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "mca-schema-"));
const config = join(dir, "prisma.config.mjs");
writeFileSync(
  config,
  `export default { schema: ${JSON.stringify(join(root, "prisma/schema.prisma"))}, datasource: { url: "file:${join(dir, "empty.db")}" } };\n`,
);
try {
  const sql = execFileSync(
    "npx",
    [
      "prisma",
      "migrate",
      "diff",
      "--config",
      config,
      "--from-empty",
      "--to-schema",
      join(root, "prisma/schema.prisma"),
      "--script",
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  process.stdout.write(sql.replace(/DEFAULT (\{\}|\[\])/g, "DEFAULT '$1'"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
