import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI (migrate, studio) needs a direct, non-pooled connection. On Supabase that is the
 * "Direct connection" string on port 5432 (DIRECT_URL). The app itself connects through the
 * pooler (DATABASE_URL, port 6543) in src/index.ts.
 */
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  ...(url ? { datasource: { url } } : {}),
});
