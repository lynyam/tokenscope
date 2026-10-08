-- CreateEnum
CREATE TYPE "TraceStatus" AS ENUM ('SUCCESS', 'ERROR');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "keyHash" VARCHAR(64) NOT NULL,
    "keyPrefix" VARCHAR(12) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelPrice" (
    "id" TEXT NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "inputUsdPerMillion" DECIMAL(18,6) NOT NULL,
    "outputUsdPerMillion" DECIMAL(18,6) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "sourceUrl" TEXT,
    "isSynthetic" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trace" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "externalId" VARCHAR(128) NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "workflow" VARCHAR(80) NOT NULL,
    "status" "TraceStatus" NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "priceVersionId" TEXT NOT NULL,
    "inputUsdPerMillion" DECIMAL(18,6) NOT NULL,
    "outputUsdPerMillion" DECIMAL(18,6) NOT NULL,
    "inputCostUsd" DECIMAL(24,12) NOT NULL,
    "outputCostUsd" DECIMAL(24,12) NOT NULL,
    "estimatedCostUsd" DECIMAL(24,12) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payloadHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Trace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileDeletionJob" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileDeletionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_projectId_createdAt_id_idx" ON "ApiKey"("projectId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ModelPrice_provider_model_effectiveFrom_key" ON "ModelPrice"("provider", "model", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Trace_projectId_deletedAt_occurredAt_id_idx" ON "Trace"("projectId", "deletedAt", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "Trace_projectId_deletedAt_provider_model_occurredAt_idx" ON "Trace"("projectId", "deletedAt", "provider", "model", "occurredAt");

-- CreateIndex
CREATE INDEX "Trace_projectId_deletedAt_status_occurredAt_idx" ON "Trace"("projectId", "deletedAt", "status", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Trace_projectId_externalId_key" ON "Trace"("projectId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDocument_storageKey_key" ON "ProjectDocument"("storageKey");

-- CreateIndex
CREATE INDEX "ProjectDocument_projectId_createdAt_id_idx" ON "ProjectDocument"("projectId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FileDeletionJob_storageKey_key" ON "FileDeletionJob"("storageKey");

-- CreateIndex
CREATE INDEX "FileDeletionJob_nextAttemptAt_idx" ON "FileDeletionJob"("nextAttemptAt");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trace" ADD CONSTRAINT "Trace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trace" ADD CONSTRAINT "Trace_priceVersionId_fkey" FOREIGN KEY ("priceVersionId") REFERENCES "ModelPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Additional invariants not represented by schema.prisma.

ALTER TABLE "ApiKey"
  ADD CONSTRAINT "ApiKey_keyHash_check"
    CHECK ("keyHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "ModelPrice"
  ADD CONSTRAINT "ModelPrice_input_rate_check"
    CHECK ("inputUsdPerMillion" BETWEEN 0 AND 999999.999999),
  ADD CONSTRAINT "ModelPrice_output_rate_check"
    CHECK ("outputUsdPerMillion" BETWEEN 0 AND 999999.999999),
  ADD CONSTRAINT "ModelPrice_currency_check"
    CHECK ("currency" = 'USD');

ALTER TABLE "Trace"
  ADD CONSTRAINT "Trace_input_tokens_check"
    CHECK ("inputTokens" BETWEEN 0 AND 1000000000),
  ADD CONSTRAINT "Trace_output_tokens_check"
    CHECK ("outputTokens" BETWEEN 0 AND 1000000000),
  ADD CONSTRAINT "Trace_latency_check"
    CHECK ("latencyMs" BETWEEN 0 AND 86400000),
  ADD CONSTRAINT "Trace_version_check"
    CHECK ("version" > 0),
  ADD CONSTRAINT "Trace_input_rate_check"
    CHECK ("inputUsdPerMillion" BETWEEN 0 AND 999999.999999),
  ADD CONSTRAINT "Trace_output_rate_check"
    CHECK ("outputUsdPerMillion" BETWEEN 0 AND 999999.999999),

  -- PostgreSQL numeric NaN passes >= 0; reject it explicitly.
  ADD CONSTRAINT "Trace_input_cost_check"
    CHECK (
      "inputCostUsd" >= 0
      AND "inputCostUsd" <> 'NaN'::numeric
    ),
  ADD CONSTRAINT "Trace_output_cost_check"
    CHECK (
      "outputCostUsd" >= 0
      AND "outputCostUsd" <> 'NaN'::numeric
    ),
  ADD CONSTRAINT "Trace_total_cost_check"
    CHECK (
      "estimatedCostUsd" >= 0
      AND "estimatedCostUsd" <> 'NaN'::numeric
    ),
  ADD CONSTRAINT "Trace_metadata_check"
    CHECK (jsonb_typeof("metadata") = 'object'),
  ADD CONSTRAINT "Trace_payloadHash_check"
    CHECK ("payloadHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "ProjectDocument"
  ADD CONSTRAINT "ProjectDocument_name_bytes_check"
    CHECK (octet_length("originalName") BETWEEN 1 AND 255),
  ADD CONSTRAINT "ProjectDocument_size_check"
    CHECK ("sizeBytes" BETWEEN 1 AND 10485760),
  ADD CONSTRAINT "ProjectDocument_media_type_check"
    CHECK (
      "mediaType" IN (
        'application/pdf',
        'text/plain',
        'text/markdown'
      )
    ),
  ADD CONSTRAINT "ProjectDocument_sha256_check"
    CHECK ("sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "FileDeletionJob"
  ADD CONSTRAINT "FileDeletionJob_attempts_check"
    CHECK ("attempts" >= 0);
