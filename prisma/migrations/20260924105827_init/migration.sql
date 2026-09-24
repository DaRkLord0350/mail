-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('READY', 'PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'READY', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'STOPPED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MissingVariableBehavior" AS ENUM ('FALLBACK', 'REMOVE', 'SKIP');

-- CreateEnum
CREATE TYPE "SuppressionSource" AS ENUM ('MANUAL', 'UNSUBSCRIBE', 'BOUNCE', 'COMPLAINT');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "displayName" TEXT,
    "website" TEXT,
    "customDomain" TEXT,
    "phone" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'READY',
    "lastSentAt" TIMESTAMPTZ(3),
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "importBatchId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "mapping" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "validLeads" INTEGER NOT NULL,
    "createdLeads" INTEGER NOT NULL,
    "updatedLeads" INTEGER NOT NULL,
    "invalidEmails" INTEGER NOT NULL,
    "duplicateEmails" INTEGER NOT NULL,
    "blankRows" INTEGER NOT NULL,
    "malformedRows" INTEGER NOT NULL,
    "missingNames" INTEGER NOT NULL,
    "missingCompanies" INTEGER NOT NULL,
    "alreadyContacted" INTEGER NOT NULL,
    "readyToSend" INTEGER NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT,
    "subjectTemplate" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "dailyLimit" INTEGER NOT NULL DEFAULT 100,
    "scheduledAt" TIMESTAMPTZ(3),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "pausedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLead" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "renderedSubject" TEXT NOT NULL,
    "renderedBody" TEXT NOT NULL,
    "subjectTemplate" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "errorCode" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMPTZ(3),
    "lockToken" TEXT,
    "errorKind" TEXT,
    "idempotencyKey" TEXT,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT,
    "source" "SuppressionSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyUsage" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    "dailyLimit" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "replyTo" TEXT,
    "dailyLimit" INTEGER,
    "sendDelaySeconds" INTEGER,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "missingVariableBehavior" "MissingVariableBehavior" NOT NULL DEFAULT 'SKIP',
    "fallbackValues" JSONB NOT NULL DEFAULT '{}',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "includeUnsubscribe" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nextSendAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRunAt" TIMESTAMPTZ(3),
    "lastResult" JSONB,
    "haltedReason" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkerState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestEmail" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "leadId" TEXT,
    "campaignId" TEXT,
    "renderedSubject" TEXT NOT NULL,
    "renderedBody" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_email_key" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_companyName_idx" ON "Lead"("companyName");

-- CreateIndex
CREATE INDEX "Lead_lastSentAt_idx" ON "Lead"("lastSentAt");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_scheduledAt_idx" ON "Campaign"("scheduledAt");

-- CreateIndex
CREATE INDEX "CampaignLead_leadId_idx" ON "CampaignLead"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLead_campaignId_leadId_key" ON "CampaignLead"("campaignId", "leadId");

-- CreateIndex
CREATE INDEX "EmailDelivery_campaignId_status_idx" ON "EmailDelivery"("campaignId", "status");

-- CreateIndex
CREATE INDEX "EmailDelivery_status_nextAttemptAt_createdAt_idx" ON "EmailDelivery"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "EmailDelivery_status_lockedAt_idx" ON "EmailDelivery"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "EmailDelivery_leadId_idx" ON "EmailDelivery"("leadId");

-- CreateIndex
CREATE INDEX "EmailDelivery_sentAt_idx" ON "EmailDelivery"("sentAt");

-- CreateIndex
CREATE INDEX "EmailDelivery_lastAttemptAt_idx" ON "EmailDelivery"("lastAttemptAt");

-- CreateIndex
CREATE INDEX "EmailDelivery_createdAt_idx" ON "EmailDelivery"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_campaignId_leadId_key" ON "EmailDelivery"("campaignId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_campaignId_email_key" ON "EmailDelivery"("campaignId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_email_key" ON "Suppression"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DailyUsage_date_scope_key" ON "DailyUsage"("date", "scope");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── MAIL: singleton rows + integrity checks (not expressible in Prisma schema) ──
INSERT INTO "WorkerState" ("id", "nextSendAt", "updatedAt") VALUES (1, now(), now()) ON CONFLICT DO NOTHING;
INSERT INTO "Settings" ("id", "updatedAt") VALUES (1, now()) ON CONFLICT DO NOTHING;
ALTER TABLE "WorkerState" ADD CONSTRAINT "WorkerState_singleton" CHECK ("id" = 1);
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_singleton" CHECK ("id" = 1);
ALTER TABLE "DailyUsage" ADD CONSTRAINT "DailyUsage_sane" CHECK ("emailsSent" >= 0 AND "dailyLimit" >= 0);
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_attempts_sane" CHECK ("attempts" >= 0);
