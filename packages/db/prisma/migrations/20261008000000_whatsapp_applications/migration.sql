-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
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
    "lastInboundAt" TIMESTAMP(3),
    "nudgeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
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
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecureFormToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "hashedToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecureFormToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationSignature" (
    "id" TEXT NOT NULL,
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
    "signedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationSignature_pkey" PRIMARY KEY ("id")
);

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

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecureFormToken" ADD CONSTRAINT "SecureFormToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecureFormToken" ADD CONSTRAINT "SecureFormToken_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSignature" ADD CONSTRAINT "ApplicationSignature_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSignature" ADD CONSTRAINT "ApplicationSignature_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Same protections as the earlier migrations: RLS on, no Data API access, tenant policy.
ALTER TABLE "WhatsAppConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecureFormToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApplicationSignature" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
DECLARE t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON "WhatsAppConversation", "WhatsAppMessage", "SecureFormToken", "ApplicationSignature" FROM %I', r);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['WhatsAppConversation', 'WhatsAppMessage', 'SecureFormToken', 'ApplicationSignature']
  LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;

-- Signature proof is append-only, like the deal timeline (forbid_mutation from the init migration).
CREATE TRIGGER application_signature_immutable BEFORE UPDATE OR DELETE ON "ApplicationSignature"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
