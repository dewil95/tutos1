-- The merchant's own application page: upload, review, e-sign (WebApplication), and the signer's
-- IP address and browser on the e-signature record.

-- AlterTable
ALTER TABLE "ApplicationSignature" ADD COLUMN "ipAddress" TEXT;

-- AlterTable
ALTER TABLE "ApplicationSignature" ADD COLUMN "userAgent" TEXT;

-- CreateTable
CREATE TABLE "WebApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "hashedToken" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "email" TEXT,
    "phone" TEXT,
    "createdByIp" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "signedAt" DATETIME,
    "signatureId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebApplication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebApplication_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WebApplication_hashedToken_key" ON "WebApplication"("hashedToken");

-- CreateIndex
CREATE INDEX "WebApplication_tenantId_dealId_idx" ON "WebApplication"("tenantId", "dealId");

-- CreateIndex
CREATE INDEX "WebApplication_createdByIp_createdAt_idx" ON "WebApplication"("createdByIp", "createdAt");
