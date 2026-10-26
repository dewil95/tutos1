-- The signature the merchant draws on the web page, kept with the e-signature record.

-- AlterTable
ALTER TABLE "ApplicationSignature" ADD COLUMN "signatureImage" TEXT;
