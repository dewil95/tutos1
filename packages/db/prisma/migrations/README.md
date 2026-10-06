# Migrations

Apply with `pnpm db:deploy` (`prisma migrate deploy`). Prisma uses `DIRECT_URL` (Supabase
"Direct connection", port 5432) for migrations; the app uses `DATABASE_URL` (Supabase pooler,
port 6543).

`20261005000000_init` contains the generated schema plus hand-written SQL at the end:

1. **RLS on every table.** On Supabase the `public` schema is exposed through the Data API to
   the `anon` and `authenticated` roles. RLS without policies for those roles blocks all browser
   access; the CRM only reads and writes from the server through Prisma (the `postgres` role,
   which bypasses RLS on Supabase).
2. **No Data API grants.** `anon` / `authenticated` lose all table and sequence privileges
   (skipped automatically on plain local Postgres where those roles do not exist).
3. **Tenant policies** keyed on `SET LOCAL app.tenant_id`, for any future non-owner app role.
4. **Append-only** triggers on `DisclosureDelivery` and `DealEvent`: updates always fail; deletes only in a transaction that runs `SET LOCAL app.allow_purge = 'on'` (see `purgeTenant` in `src/tenant.ts`).

When adding a migration, generate it with `pnpm db:migrate` against a local database, then
re-run the RLS block from step 1 at the end of the new migration so new tables are covered.
