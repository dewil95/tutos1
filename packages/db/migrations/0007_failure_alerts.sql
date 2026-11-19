-- Admins are emailed when background jobs give up, at most once an hour per tenant.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "lastFailureAlertAt" DATETIME;
