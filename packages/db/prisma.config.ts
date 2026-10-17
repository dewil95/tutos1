import { defineConfig } from "prisma/config";

/**
 * The database is a SQLite file on the server. Prisma generates the client and the migration
 * SQL (`pnpm schema:sql`); `pnpm migrate` applies `migrations/*.sql` to the file.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
});
