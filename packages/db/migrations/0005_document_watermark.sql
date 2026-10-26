-- Watermarked PDFs (stamped copies instead of the bank's original) are flagged and never sent.

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "watermarked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "watermarkReason" TEXT;
