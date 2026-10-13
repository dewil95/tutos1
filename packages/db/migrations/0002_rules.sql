-- Rules the app relies on, kept in the database itself (D1 has no row-level security; tenant
-- scoping is done in code). Each trigger sits on one line so migration runners can split on ";\n".

-- Purge switch: history rows can only be deleted while this is on (purgeTenant, test cleanup).
INSERT INTO "PurgeFlag" ("id", "on") VALUES (1, 0);

-- Append-only history: the deal timeline, disclosure delivery proof (NY 23 NYCRR 600) and
-- e-signature records can never be edited, and only deleted by a purge.
CREATE TRIGGER deal_event_no_update BEFORE UPDATE ON "DealEvent" BEGIN SELECT RAISE(ABORT, 'table DealEvent is append-only'); END;
CREATE TRIGGER deal_event_no_delete BEFORE DELETE ON "DealEvent" WHEN (SELECT "on" FROM "PurgeFlag" WHERE "id" = 1) IS NOT 1 BEGIN SELECT RAISE(ABORT, 'table DealEvent is append-only'); END;
CREATE TRIGGER disclosure_no_update BEFORE UPDATE ON "DisclosureDelivery" BEGIN SELECT RAISE(ABORT, 'table DisclosureDelivery is append-only'); END;
CREATE TRIGGER disclosure_no_delete BEFORE DELETE ON "DisclosureDelivery" WHEN (SELECT "on" FROM "PurgeFlag" WHERE "id" = 1) IS NOT 1 BEGIN SELECT RAISE(ABORT, 'table DisclosureDelivery is append-only'); END;
CREATE TRIGGER signature_no_update BEFORE UPDATE ON "ApplicationSignature" BEGIN SELECT RAISE(ABORT, 'table ApplicationSignature is append-only'); END;
CREATE TRIGGER signature_no_delete BEFORE DELETE ON "ApplicationSignature" WHEN (SELECT "on" FROM "PurgeFlag" WHERE "id" = 1) IS NOT 1 BEGIN SELECT RAISE(ABORT, 'table ApplicationSignature is append-only'); END;
