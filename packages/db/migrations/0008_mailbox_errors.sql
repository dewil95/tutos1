-- A mailbox whose Google access expired says so in Settings instead of failing quietly.

-- AlterTable
ALTER TABLE "MailboxConnection" ADD COLUMN "lastError" TEXT;

-- Requested amounts under $1,000 were misreads ("$1"): unknown is more honest, and it stops the
-- lender ranking from ruling lenders out for "requested below min advance".
UPDATE "Deal" SET "requestedAmount" = NULL WHERE "requestedAmount" IS NOT NULL AND "requestedAmount" < 1000;
