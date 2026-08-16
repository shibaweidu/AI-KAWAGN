CREATE TYPE "GatewayProbeKind" AS ENUM ('MODELS', 'INFERENCE');
CREATE TYPE "GatewayProbeModelStatus" AS ENUM ('UNTESTED', 'AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'PROTOCOL_UNSUPPORTED');
CREATE TYPE "GatewayProbeErrorCategory" AS ENUM ('TIMEOUT', 'RATE_LIMITED', 'AUTHENTICATION', 'QUOTA_EXHAUSTED', 'MODEL_UNAVAILABLE', 'UPSTREAM_ERROR', 'PROTOCOL_ERROR', 'NETWORK_ERROR');

CREATE TABLE "GatewayProbeConfig" (
  "id" TEXT NOT NULL,
  "gatewayId" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "apiKeyCiphertext" TEXT,
  "apiKeyLastFour" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "inferencePaused" BOOLEAN NOT NULL DEFAULT false,
  "pauseReason" "GatewayProbeErrorCategory",
  "modelListIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
  "inferenceIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
  "nextModelListAt" TIMESTAMP(3),
  "nextInferenceAt" TIMESTAMP(3),
  "modelListRequestedAt" TIMESTAMP(3),
  "inferenceRequestedAt" TIMESTAMP(3),
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "lastModelListAt" TIMESTAMP(3),
  "lastInferenceAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GatewayProbeConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GatewayProbeModel" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "status" "GatewayProbeModelStatus" NOT NULL DEFAULT 'UNTESTED',
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "lastCheckedAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastResponseMs" INTEGER,
  "lastErrorCategory" "GatewayProbeErrorCategory",
  "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GatewayProbeModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GatewayProbeResult" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "modelId" TEXT,
  "kind" "GatewayProbeKind" NOT NULL,
  "success" BOOLEAN NOT NULL,
  "errorCategory" "GatewayProbeErrorCategory",
  "httpStatus" INTEGER,
  "dnsMs" INTEGER,
  "connectMs" INTEGER,
  "ttfbMs" INTEGER,
  "totalMs" INTEGER,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GatewayProbeResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GatewayProbeConfig_gatewayId_key" ON "GatewayProbeConfig"("gatewayId");
CREATE INDEX "GatewayProbeConfig_enabled_nextModelListAt_idx" ON "GatewayProbeConfig"("enabled", "nextModelListAt");
CREATE INDEX "GatewayProbeConfig_enabled_nextInferenceAt_idx" ON "GatewayProbeConfig"("enabled", "nextInferenceAt");
CREATE INDEX "GatewayProbeConfig_leaseUntil_idx" ON "GatewayProbeConfig"("leaseUntil");
CREATE UNIQUE INDEX "GatewayProbeModel_configId_modelId_key" ON "GatewayProbeModel"("configId", "modelId");
CREATE INDEX "GatewayProbeModel_configId_enabled_idx" ON "GatewayProbeModel"("configId", "enabled");
CREATE INDEX "GatewayProbeResult_configId_kind_checkedAt_idx" ON "GatewayProbeResult"("configId", "kind", "checkedAt");
CREATE INDEX "GatewayProbeResult_modelId_checkedAt_idx" ON "GatewayProbeResult"("modelId", "checkedAt");
CREATE INDEX "GatewayProbeResult_checkedAt_idx" ON "GatewayProbeResult"("checkedAt");

ALTER TABLE "GatewayProbeConfig" ADD CONSTRAINT "GatewayProbeConfig_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "GatewayDirectoryEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GatewayProbeModel" ADD CONSTRAINT "GatewayProbeModel_configId_fkey" FOREIGN KEY ("configId") REFERENCES "GatewayProbeConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GatewayProbeResult" ADD CONSTRAINT "GatewayProbeResult_configId_fkey" FOREIGN KEY ("configId") REFERENCES "GatewayProbeConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GatewayProbeResult" ADD CONSTRAINT "GatewayProbeResult_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "GatewayProbeModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
