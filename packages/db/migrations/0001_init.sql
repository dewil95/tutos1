-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "stateRegistrations" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "fromAddress" TEXT,
    "teamCc" JSONB NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "authUserId" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OPENER',
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceDetail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
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
    "statedMonthlyRevenue" DECIMAL,
    "statedTimeInBusinessMonths" INTEGER,
    "requestedAmount" DECIMAL,
    "dncScrubbedAt" DATETIME,
    "dncStatus" TEXT,
    "rawPayload" JSONB,
    "merchantId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "text" TEXT,
    "ipAddress" TEXT,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "Consent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "dba" TEXT,
    "entityType" TEXT,
    "einEncrypted" TEXT,
    "einLast4" TEXT,
    "naics" TEXT,
    "industry" TEXT,
    "startDate" DATETIME,
    "website" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "sosStatus" TEXT,
    "sosCheckedAt" DATETIME,
    "bankName" TEXT,
    "processorName" TEXT,
    "emailOptOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Merchant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "ownershipPct" DECIMAL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Owner_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "ownerId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'INTAKE',
    "stageChangedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedAmount" DECIMAL,
    "useOfFunds" TEXT,
    "statedMonthlyRevenue" DECIMAL,
    "isRenewal" BOOLEAN NOT NULL DEFAULT false,
    "parentDealId" TEXT,
    "paperGrade" TEXT,
    "lostReason" TEXT,
    "driveFolderId" TEXT,
    "sourceThreadId" TEXT,
    "soldAmount" DECIMAL,
    "soldFactor" DECIMAL,
    "soldTermDays" INTEGER,
    "submissionPositions" JSONB NOT NULL DEFAULT '[]',
    "submissionNote" TEXT,
    "source" TEXT NOT NULL DEFAULT 'staff',
    "externalRef" TEXT,
    "applicationData" JSONB,
    "riskReport" JSONB,
    "riskReportAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Deal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deal_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Deal_parentDealId_fkey" FOREIGN KEY ("parentDealId") REFERENCES "Deal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DealEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DealEvent_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "merchantId" TEXT,
    "dealId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "typeConfidence" REAL,
    "driveFileId" TEXT NOT NULL,
    "driveWebViewLink" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "pageCount" INTEGER,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "bankName" TEXT,
    "accountLast4" TEXT,
    "extraction" JSONB,
    "fraudFlags" JSONB,
    "uploadedById" TEXT,
    "uploadedVia" TEXT NOT NULL DEFAULT 'staff',
    "gmailMessageId" TEXT,
    "internalOnly" BOOLEAN NOT NULL DEFAULT false,
    "extractedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Document_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BankAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "documentIds" JSONB NOT NULL DEFAULT '[]',
    "monthlyRows" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "trueRevenueAdjustments" JSONB,
    "paperGrade" TEXT,
    "redFlags" JSONB,
    "maxAdvanceEstimate" DECIMAL,
    "summary" TEXT,
    "scrub" JSONB,
    "aiRunId" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankAnalysis_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "funderGuess" TEXT,
    "funderId" TEXT,
    "descriptor" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "paymentAmount" DECIMAL NOT NULL,
    "firstSeen" DATETIME,
    "lastSeen" DATETIME,
    "estimatedBalance" DECIMAL,
    "confidence" REAL NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "confirmedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Position_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Position_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Funder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "submissionTo" TEXT,
    "submissionCc" JSONB NOT NULL DEFAULT '[]',
    "emailDomains" JSONB NOT NULL DEFAULT '[]',
    "achDescriptors" JSONB NOT NULL DEFAULT '[]',
    "isoAgreementNotes" TEXT,
    "renewalCommissionPct" DECIMAL,
    "clawbackDays" INTEGER,
    "backdoorProtection" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Funder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FunderProgram" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "funderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "submissionEmail" TEXT,
    "portalUrl" TEXT,
    "paperGrades" JSONB NOT NULL DEFAULT '[]',
    "minMonthlyRevenue" DECIMAL,
    "minTimeInBusinessMonths" INTEGER,
    "minFico" INTEGER,
    "maxExistingPositions" INTEGER,
    "positionAppetite" JSONB NOT NULL DEFAULT '[]',
    "minAdvance" DECIMAL,
    "maxAdvance" DECIMAL,
    "maxFactorSell" DECIMAL,
    "buyRateFloor" DECIMAL,
    "maxPoints" DECIMAL,
    "allowedStates" JSONB NOT NULL DEFAULT '[]',
    "excludedStates" JSONB NOT NULL DEFAULT '[]',
    "excludedNaics" JSONB NOT NULL DEFAULT '[]',
    "requiredDocs" JSONB NOT NULL DEFAULT '[]',
    "typicalTurnaroundHours" INTEGER,
    "renewalEligibilityPct" DECIMAL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "FunderProgram_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FunderContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "funderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    CONSTRAINT "FunderContact_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "funderId" TEXT NOT NULL,
    "programId" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sentAt" DATETIME,
    "sentById" TEXT,
    "externalRef" TEXT,
    "gmailThreadId" TEXT,
    "gmailMessageId" TEXT,
    "toAddresses" JSONB NOT NULL DEFAULT '[]',
    "ccAddresses" JSONB NOT NULL DEFAULT '[]',
    "packageDocumentIds" JSONB NOT NULL DEFAULT '[]',
    "watermarkTag" TEXT,
    "declineReason" TEXT,
    "slaDueAt" DATETIME,
    "lastFunderMessageAt" DATETIME,
    "rawStatusLog" JSONB NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Submission_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Submission_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Submission_programId_fkey" FOREIGN KEY ("programId") REFERENCES "FunderProgram" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "submissionId" TEXT,
    "funderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "advanceAmount" DECIMAL NOT NULL,
    "buyRate" DECIMAL NOT NULL,
    "sellRate" DECIMAL NOT NULL,
    "paybackAmount" DECIMAL NOT NULL,
    "termMonths" DECIMAL,
    "numberOfPayments" INTEGER,
    "paymentFrequency" TEXT NOT NULL,
    "paymentAmount" DECIMAL NOT NULL,
    "holdbackPct" DECIMAL,
    "originationFee" DECIMAL,
    "otherFees" JSONB,
    "psfAmount" DECIMAL,
    "commissionPoints" DECIMAL,
    "commissionAmount" DECIMAL,
    "estimatedApr" DECIMAL,
    "position" INTEGER,
    "expiresAt" DATETIME,
    "rawText" TEXT,
    "sourceDocumentId" TEXT,
    "aiRunId" TEXT,
    "confirmedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Offer_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Offer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Offer_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Stipulation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "offerId" TEXT,
    "name" TEXT NOT NULL,
    "documentType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "ownerUserId" TEXT,
    "documentId" TEXT,
    "nextChaseAt" DATETIME,
    "chaseCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Stipulation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Stipulation_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "esignProvider" TEXT,
    "esignEnvelopeId" TEXT,
    "documentId" TEXT,
    "sentAt" DATETIME,
    "signedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contract_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Contract_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DisclosureDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "offerId" TEXT,
    "state" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentSha256" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "deliveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredById" TEXT,
    "aiCheck" JSONB,
    CONSTRAINT "DisclosureDelivery_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Funding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "fundedAt" DATETIME NOT NULL,
    "fundedAmount" DECIMAL NOT NULL,
    "netToMerchant" DECIMAL,
    "paybackAmount" DECIMAL NOT NULL,
    "paymentAmount" DECIMAL NOT NULL,
    "paymentFrequency" TEXT NOT NULL,
    "firstPaymentAt" DATETIME,
    "uccFiledAt" DATETIME,
    "clawbackWindowEndsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Funding_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "funderName" TEXT NOT NULL,
    "points" DECIMAL NOT NULL,
    "expectedAmount" DECIMAL NOT NULL,
    "receivedAmount" DECIMAL,
    "psfAmount" DECIMAL,
    "status" TEXT NOT NULL DEFAULT 'EXPECTED',
    "expectedAt" DATETIME,
    "receivedAt" DATETIME,
    "clawbackWindowEndsAt" DATETIME,
    "clawedBackAt" DATETIME,
    "clawbackAmount" DECIMAL,
    "repSplits" JSONB,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Commission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Commission_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Renewal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "paybackAmount" DECIMAL NOT NULL,
    "paidToDate" DECIMAL NOT NULL DEFAULT 0,
    "paidDownPct" DECIMAL NOT NULL DEFAULT 0,
    "eligibilityPct" DECIMAL NOT NULL DEFAULT 50,
    "projectedEligibleAt" DATETIME,
    "eligibleAt" DATETIME,
    "outreachStartedAt" DATETIME,
    "renewalDealId" TEXT,
    "lastCheckedAt" DATETIME,
    CONSTRAINT "Renewal_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'INTERNAL',
    "userId" TEXT,
    "leadId" TEXT,
    "dealId" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "externalId" TEXT,
    "threadId" TEXT,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "aiSummary" JSONB,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Activity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Activity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Activity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "leadId" TEXT,
    "dealId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdBy" TEXT NOT NULL DEFAULT 'user',
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Sequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sequenceId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "delayMinutes" INTEGER NOT NULL,
    "template" TEXT NOT NULL,
    "aiPersonalise" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "SequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "costUsd" DECIMAL NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "stopReason" TEXT,
    "output" JSONB,
    "error" TEXT,
    "verdict" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewedAt" DATETIME,
    "correction" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AiRun_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AiRun_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockedAt" DATETIME,
    "lastError" TEXT,
    "dedupeKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MailboxConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "historyId" TEXT,
    "lastSyncedAt" DATETIME,
    "driveRootFolderId" TEXT,
    "connectedById" TEXT,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MailboxConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "createdById" TEXT,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "delayHours" INTEGER NOT NULL DEFAULT 24,
    "maxSends" INTEGER NOT NULL DEFAULT 1,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "language" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "step" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "fieldState" JSONB NOT NULL DEFAULT '{}',
    "piiEncrypted" TEXT,
    "pendingSignerName" TEXT,
    "pendingNameMessageId" TEXT,
    "dealId" TEXT,
    "lastInboundAt" DATETIME,
    "nudgeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppConversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WhatsAppConversation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "waMessageId" TEXT,
    "kind" TEXT NOT NULL,
    "text" TEXT,
    "buttonId" TEXT,
    "mediaId" TEXT,
    "mimeType" TEXT,
    "fileName" TEXT,
    "documentId" TEXT,
    "status" TEXT,
    "error" TEXT,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SecureFormToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "hashedToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecureFormToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SecureFormToken_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApplicationSignature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "conversationId" TEXT,
    "signerName" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "consentText" TEXT NOT NULL,
    "consentSha256" TEXT NOT NULL,
    "nameMessageId" TEXT,
    "agreeMessageId" TEXT,
    "documentId" TEXT NOT NULL,
    "pdfSha256" TEXT NOT NULL,
    "signedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationSignature_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApplicationSignature_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurgeFlag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "on" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");

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
CREATE UNIQUE INDEX "Deal_tenantId_externalRef_key" ON "Deal"("tenantId", "externalRef");

-- CreateIndex
CREATE INDEX "DealEvent_dealId_createdAt_idx" ON "DealEvent"("dealId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_driveFileId_key" ON "Document"("driveFileId");

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
CREATE INDEX "Submission_gmailThreadId_idx" ON "Submission"("gmailThreadId");

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

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxConnection_tenantId_email_key" ON "MailboxConnection"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hashedKey_key" ON "ApiKey"("hashedKey");

-- CreateIndex
CREATE INDEX "ApiKey_tenantId_idx" ON "ApiKey"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailRule_tenantId_kind_key" ON "EmailRule"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversation_dealId_key" ON "WhatsAppConversation"("dealId");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_tenantId_phone_status_idx" ON "WhatsAppConversation"("tenantId", "phone", "status");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_tenantId_status_lastInboundAt_idx" ON "WhatsAppConversation"("tenantId", "status", "lastInboundAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_waMessageId_key" ON "WhatsAppMessage"("waMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_conversationId_createdAt_idx" ON "WhatsAppMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecureFormToken_hashedToken_key" ON "SecureFormToken"("hashedToken");

-- CreateIndex
CREATE INDEX "SecureFormToken_conversationId_idx" ON "SecureFormToken"("conversationId");

-- CreateIndex
CREATE INDEX "ApplicationSignature_tenantId_dealId_idx" ON "ApplicationSignature"("tenantId", "dealId");

