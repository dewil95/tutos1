# Migrations

Generated with `pnpm db:migrate` (`prisma migrate dev`) against the docker-compose Postgres.

Two hand-written SQL additions must accompany the first migration (add them to the generated
`migration.sql` before committing):

1. **Row-level security** on every table with `tenantId`:

   ```sql
   ALTER TABLE "Deal" ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON "Deal"
     USING ("tenantId" = current_setting('app.tenant_id', true));
   -- repeat for Lead, Merchant, Document, Funder, Activity, Task, Sequence, Commission, AiRun
   ```

   The app sets `SET LOCAL app.tenant_id = '<id>'` at the start of every transaction
   (see `packages/db/src/tenant.ts`).

2. **Immutability** of `DisclosureDelivery` and `DealEvent`:

   ```sql
   CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
   BEGIN RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME; END;
   $$ LANGUAGE plpgsql;
   CREATE TRIGGER disclosure_immutable BEFORE UPDATE OR DELETE ON "DisclosureDelivery"
     FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
   CREATE TRIGGER deal_event_immutable BEFORE UPDATE OR DELETE ON "DealEvent"
     FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
   ```
