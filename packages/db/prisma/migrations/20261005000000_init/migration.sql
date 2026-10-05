-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'OPENER', 'CLOSER', 'PROCESSOR', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('UCC_LIST', 'AGED_LIST', 'LIVE_TRANSFER', 'WEB_FORM', 'REFERRAL', 'INBOUND_CALL', 'ZAPIER', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTING', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('SMS', 'VOICE', 'EMAIL', 'AUTODIALER');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('LLC', 'CORP', 'S_CORP', 'SOLE_PROP', 'PARTNERSHIP', 'NONPROFIT', 'OTHER');

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('INTAKE', 'DOCS_REQUESTED', 'DOCS_RECEIVED', 'PRE_UNDERWRITING', 'READY_TO_SUBMIT', 'SUBMITTED', 'OFFERS_RECEIVED', 'OFFER_ACCEPTED', 'STIPS', 'CONTRACT_OUT', 'FUNDED', 'RENEWAL_ELIGIBLE', 'DECLINED', 'DEAD');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('APPLICATION', 'BANK_STATEMENT', 'VOIDED_CHECK', 'DRIVERS_LICENSE', 'TAX_RETURN', 'PROFIT_AND_LOSS', 'AR_AGING', 'PROCESSING_STATEMENT', 'MTD_STATEMENT', 'LEASE', 'ARTICLES', 'PAYOFF_LETTER', 'CONTRACT', 'DISCLOSURE', 'OFFER_SHEET', 'COMMISSION_STATEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "SubmissionChannel" AS ENUM ('EMAIL', 'PORTAL', 'API');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SENT', 'ACKNOWLEDGED', 'IN_REVIEW', 'STIPS_REQUESTED', 'APPROVED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentFrequency" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('RECEIVED', 'PRESENTED', 'ACCEPTED', 'DECLINED_BY_MERCHANT', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "StipStatus" AS ENUM ('REQUESTED', 'SENT_TO_MERCHANT', 'RECEIVED', 'CLEARED', 'WAIVED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('SENT', 'VIEWED', 'SIGNED', 'COUNTERSIGNED', 'VOIDED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('EXPECTED', 'INVOICED', 'RECEIVED', 'PARTIALLY_RECEIVED', 'CLAWED_BACK', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CALL', 'SMS', 'EMAIL', 'NOTE', 'MEETING', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActivityDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiVerdict" AS ENUM ('PENDING', 'ACCEPTED', 'CORRECTED', 'REJECTED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "stateRegistrations" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OPENER',
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT,
    "source" "LeadSource" NOT NULL DEFAULT 'MANUAL',
    "sourceDetail" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "score" INTEGER,
    "scoreReason" TEXT,
    "businessName" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "state" TEXT,
    "timezone" TEXT,
    "industry" TEXT,
    "naics" TEXT,
    "statedMonthlyRevenue" DECIMAL(14,2),
    "statedTimeInBusinessMonths" INTEGER,
    "requestedAmount" DECIMAL(14,2),
    "dncScrubbedAt" TIMESTAMP(3),
    "dncStatus" TEXT,
    "rawPayload" JSONB,
    "merchantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" "ConsentChannel" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "text" TEXT,
    "ipAddress" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "dba" TEXT,
    "entityType" "EntityType",
    "einEncrypted" TEXT,
    "einLast4" TEXT,
    "naics" TEXT,
    "industry" TEXT,
    "startDate" TIMESTAMP(3),
    "website" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "sosStatus" TEXT,
    "sosCheckedAt" TIMESTAMP(3),
    "bankName" TEXT,
    "processorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "ownershipPct" DECIMAL(5,2),
    "ssnEncrypted" TEXT,
    "ssnLast4" TEXT,
    "dobEncrypted" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "ficoEstimate" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "ownerId" TEXT,
    "stage" "DealStage" NOT NULL DEFAULT 'INTAKE',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedAmount" DECIMAL(14,2),
    "useOfFunds" TEXT,
    "isRenewal" BOOLEAN NOT NULL DEFAULT false,
    "parentDealId" TEXT,
    "paperGrade" TEXT,
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealEvent" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "merchantId" TEXT,
    "dealId" TEXT,
    "type" "DocumentType" NOT NULL DEFAULT 'OTHER',
    "typeConfidence" DOUBLE PRECISION,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "pageCount" INTEGER,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "bankName" TEXT,
    "accountLast4" TEXT,
    "extraction" JSONB,
    "fraudFlags" JSONB,
    "uploadedById" TEXT,
    "uploadedVia" TEXT NOT NULL DEFAULT 'staff',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAnalysis" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "documentIds" TEXT[],
    "monthlyRows" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "trueRevenueAdjustments" JSONB,
    "paperGrade" TEXT,
    "redFlags" JSONB,
    "maxAdvanceEstimate" DECIMAL(14,2),
    "summary" TEXT,
    "aiRunId" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "funderGuess" TEXT,
    "funderId" TEXT,
    "descriptor" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "paymentAmount" DECIMAL(14,2) NOT NULL,
    "firstSeen" TIMESTAMP(3),
    "lastSeen" TIMESTAMP(3),
    "estimatedBalance" DECIMAL(14,2),
    "confidence" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Funder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "achDescriptors" TEXT[],
    "isoAgreementNotes" TEXT,
    "renewalCommissionPct" DECIMAL(5,2),
    "clawbackDays" INTEGER,
    "backdoorProtection" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Funder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunderProgram" (
    "id" TEXT NOT NULL,
    "funderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "SubmissionChannel" NOT NULL DEFAULT 'EMAIL',
    "submissionEmail" TEXT,
    "portalUrl" TEXT,
    "paperGrades" TEXT[],
    "minMonthlyRevenue" DECIMAL(14,2),
    "minTimeInBusinessMonths" INTEGER,
    "minFico" INTEGER,
    "maxExistingPositions" INTEGER,
    "positionAppetite" TEXT[],
    "minAdvance" DECIMAL(14,2),
    "maxAdvance" DECIMAL(14,2),
    "maxFactorSell" DECIMAL(5,4),
    "buyRateFloor" DECIMAL(5,4),
    "maxPoints" DECIMAL(5,2),
    "allowedStates" TEXT[],
    "excludedStates" TEXT[],
    "excludedNaics" TEXT[],
    "requiredDocs" TEXT[],
    "typicalTurnaroundHours" INTEGER,
    "renewalEligibilityPct" DECIMAL(5,2),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FunderProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunderContact" (
    "id" TEXT NOT NULL,
    "funderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,

    CONSTRAINT "FunderContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "funderId" TEXT NOT NULL,
    "programId" TEXT,
    "channel" "SubmissionChannel" NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "packageDocumentIds" TEXT[],
    "watermarkTag" TEXT,
    "declineReason" TEXT,
    "slaDueAt" TIMESTAMP(3),
    "lastFunderMessageAt" TIMESTAMP(3),
    "rawStatusLog" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "submissionId" TEXT,
    "funderId" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'RECEIVED',
    "advanceAmount" DECIMAL(14,2) NOT NULL,
    "buyRate" DECIMAL(6,4) NOT NULL,
    "sellRate" DECIMAL(6,4) NOT NULL,
    "paybackAmount" DECIMAL(14,2) NOT NULL,
    "termMonths" DECIMAL(5,2),
    "numberOfPayments" INTEGER,
    "paymentFrequency" "PaymentFrequency" NOT NULL,
    "paymentAmount" DECIMAL(14,2) NOT NULL,
    "holdbackPct" DECIMAL(5,2),
    "originationFee" DECIMAL(14,2),
    "otherFees" JSONB,
    "psfAmount" DECIMAL(14,2),
    "commissionPoints" DECIMAL(5,2),
    "commissionAmount" DECIMAL(14,2),
    "estimatedApr" DECIMAL(8,4),
    "position" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "rawText" TEXT,
    "sourceDocumentId" TEXT,
    "aiRunId" TEXT,
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stipulation" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "offerId" TEXT,
    "name" TEXT NOT NULL,
    "documentType" "DocumentType",
    "status" "StipStatus" NOT NULL DEFAULT 'REQUESTED',
    "ownerUserId" TEXT,
    "documentId" TEXT,
    "nextChaseAt" TIMESTAMP(3),
    "chaseCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stipulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'SENT',
    "esignProvider" TEXT,
    "esignEnvelopeId" TEXT,
    "documentId" TEXT,
    "sentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisclosureDelivery" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "offerId" TEXT,
    "state" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentSha256" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredById" TEXT,
    "aiCheck" JSONB,

    CONSTRAINT "DisclosureDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Funding" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "fundedAt" TIMESTAMP(3) NOT NULL,
    "fundedAmount" DECIMAL(14,2) NOT NULL,
    "netToMerchant" DECIMAL(14,2),
    "paybackAmount" DECIMAL(14,2) NOT NULL,
    "paymentAmount" DECIMAL(14,2) NOT NULL,
    "paymentFrequency" "PaymentFrequency" NOT NULL,
    "firstPaymentAt" TIMESTAMP(3),
    "uccFiledAt" TIMESTAMP(3),
    "clawbackWindowEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Funding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "funderName" TEXT NOT NULL,
    "points" DECIMAL(5,2) NOT NULL,
    "expectedAmount" DECIMAL(14,2) NOT NULL,
    "receivedAmount" DECIMAL(14,2),
    "psfAmount" DECIMAL(14,2),
    "status" "CommissionStatus" NOT NULL DEFAULT 'EXPECTED',
    "expectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "clawbackWindowEndsAt" TIMESTAMP(3),
    "clawedBackAt" TIMESTAMP(3),
    "clawbackAmount" DECIMAL(14,2),
    "repSplits" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Renewal" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "paybackAmount" DECIMAL(14,2) NOT NULL,
    "paidToDate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidDownPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "eligibilityPct" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "projectedEligibleAt" TIMESTAMP(3),
    "eligibleAt" TIMESTAMP(3),
    "outreachStartedAt" TIMESTAMP(3),
    "renewalDealId" TEXT,
    "lastCheckedAt" TIMESTAMP(3),

    CONSTRAINT "Renewal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "direction" "ActivityDirection" NOT NULL DEFAULT 'INTERNAL',
    "userId" TEXT,
    "leadId" TEXT,
    "dealId" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "externalId" TEXT,
    "threadId" TEXT,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "durationSec" INTEGER,
    "recordingUrl" TEXT,
    "transcript" TEXT,
    "aiSummary" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "leadId" TEXT,
    "dealId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "createdBy" TEXT NOT NULL DEFAULT 'user',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "channel" "ActivityType" NOT NULL,
    "delayMinutes" INTEGER NOT NULL,
    "template" TEXT NOT NULL,
    "aiPersonalise" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "dealId" TEXT,
    "job" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "effort" TEXT,
    "inputHash" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "stopReason" TEXT,
    "output" JSONB,
    "error" TEXT,
    "verdict" "AiVerdict" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "correction" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Lead_tenantId_status_idx" ON "Lead"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Lead_tenantId_phone_idx" ON "Lead"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "Lead_tenantId_email_idx" ON "Lead"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Consent_leadId_channel_idx" ON "Consent"("leadId", "channel");

-- CreateIndex
CREATE INDEX "Merchant_tenantId_legalName_idx" ON "Merchant"("tenantId", "legalName");

-- CreateIndex
CREATE INDEX "Owner_merchantId_idx" ON "Owner"("merchantId");

-- CreateIndex
CREATE INDEX "Deal_tenantId_stage_idx" ON "Deal"("tenantId", "stage");

-- CreateIndex
CREATE INDEX "Deal_tenantId_ownerId_idx" ON "Deal"("tenantId", "ownerId");

-- CreateIndex
CREATE INDEX "DealEvent_dealId_createdAt_idx" ON "DealEvent"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "Document_tenantId_dealId_idx" ON "Document"("tenantId", "dealId");

-- CreateIndex
CREATE INDEX "Document_sha256_idx" ON "Document"("sha256");

-- CreateIndex
CREATE INDEX "BankAnalysis_dealId_idx" ON "BankAnalysis"("dealId");

-- CreateIndex
CREATE INDEX "Position_dealId_idx" ON "Position"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "Funder_tenantId_name_key" ON "Funder"("tenantId", "name");

-- CreateIndex
CREATE INDEX "FunderProgram_funderId_idx" ON "FunderProgram"("funderId");

-- CreateIndex
CREATE INDEX "Submission_dealId_status_idx" ON "Submission"("dealId", "status");

-- CreateIndex
CREATE INDEX "Submission_funderId_idx" ON "Submission"("funderId");

-- CreateIndex
CREATE INDEX "Offer_dealId_status_idx" ON "Offer"("dealId", "status");

-- CreateIndex
CREATE INDEX "Stipulation_dealId_status_idx" ON "Stipulation"("dealId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_offerId_key" ON "Contract"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "Funding_dealId_key" ON "Funding"("dealId");

-- CreateIndex
CREATE INDEX "Commission_tenantId_status_idx" ON "Commission"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Renewal_dealId_key" ON "Renewal"("dealId");

-- CreateIndex
CREATE INDEX "Activity_tenantId_dealId_occurredAt_idx" ON "Activity"("tenantId", "dealId", "occurredAt");

-- CreateIndex
CREATE INDEX "Activity_tenantId_leadId_occurredAt_idx" ON "Activity"("tenantId", "leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "Activity_externalId_idx" ON "Activity"("externalId");

-- CreateIndex
CREATE INDEX "Task_tenantId_assigneeId_status_idx" ON "Task"("tenantId", "assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_tenantId_name_key" ON "Sequence"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceStep_sequenceId_order_key" ON "SequenceStep"("sequenceId", "order");

-- CreateIndex
CREATE INDEX "AiRun_tenantId_job_createdAt_idx" ON "AiRun"("tenantId", "job", "createdAt");

-- CreateIndex
CREATE INDEX "AiRun_dealId_idx" ON "AiRun"("dealId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Owner" ADD CONSTRAINT "Owner_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_parentDealId_fkey" FOREIGN KEY ("parentDealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealEvent" ADD CONSTRAINT "DealEvent_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAnalysis" ADD CONSTRAINT "BankAnalysis_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Funder" ADD CONSTRAINT "Funder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunderProgram" ADD CONSTRAINT "FunderProgram_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunderContact" ADD CONSTRAINT "FunderContact_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_programId_fkey" FOREIGN KEY ("programId") REFERENCES "FunderProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stipulation" ADD CONSTRAINT "Stipulation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stipulation" ADD CONSTRAINT "Stipulation_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisclosureDelivery" ADD CONSTRAINT "DisclosureDelivery_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Funding" ADD CONSTRAINT "Funding_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Renewal" ADD CONSTRAINT "Renewal_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written additions (see prisma/migrations/README.md)
-- ---------------------------------------------------------------------------

-- Row-level security: every tenant-scoped table is filtered by app.tenant_id, which the
-- application sets with `SET LOCAL app.tenant_id = '<id>'` inside each transaction
-- (packages/db/src/tenant.ts). Note: the table owner / superusers bypass RLS unless FORCE is
-- set, so production must connect as a non-owner application role.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['User','Lead','Merchant','Deal','Document','Funder','Activity','Task','Sequence','Commission']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;

-- AiRun may be recorded without a tenant (evals, system jobs).
ALTER TABLE "AiRun" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiRun"
  USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true));

-- Append-only tables: disclosure delivery proof (NY 23 NYCRR 600) and the deal timeline.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER disclosure_immutable BEFORE UPDATE OR DELETE ON "DisclosureDelivery"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER deal_event_immutable BEFORE UPDATE OR DELETE ON "DealEvent"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
