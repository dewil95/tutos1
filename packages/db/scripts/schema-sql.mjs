#!/usr/bin/env node
/**
 * Prints the SQL that creates the current Prisma schema on SQLite (used to write migrations).
 * With `--from-db <file>`, prints what would still change from that database to the schema
 * instead; a test applies every migration to a fresh file and expects nothing left.
 * Prisma emits JSON defaults unquoted (`DEFAULT []`), which SQLite rejects; this quotes them.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "mca-schema-"));
const at = process.argv.indexOf("--from-db");
const fromDb = at > 0 ? process.argv[at + 1] : null;
const config = join(dir, "prisma.config.mjs");
writeFileSync(
  config,
  `export default { schema: ${JSON.stringify(join(root, "prisma/schema.prisma"))}, datasource: { url: ${JSON.stringify(`file:${fromDb ?? join(dir, "empty.db")}`)} } };\n`,
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
      fromDb ? "--from-config-datasource" : "--from-empty",
      "--to-schema",
      join(root, "prisma/schema.prisma"),
      "--script",
    ],
    // Windows only finds npx (npx.cmd) through a shell.
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      shell: process.platform === "win32",
    },
  );
  process.stdout.write(sql.replace(/DEFAULT (\{\}|\[\])/g, "DEFAULT '$1'"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
