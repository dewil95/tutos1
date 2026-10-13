import { defineConfig } from "prisma/config";

/**
 * The database is Cloudflare D1. Prisma generates the client and the migration SQL; wrangler
 * applies migrations (`migrations/*.sql`, see package.json "migrations:*").
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
});
