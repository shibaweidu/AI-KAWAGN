CREATE TYPE "BotPlatform" AS ENUM ('TELEGRAM', 'QQ');
CREATE TYPE "BotRuntimeStatus" AS ENUM ('DISABLED', 'WAITING_CONFIG', 'STARTING', 'RUNNING', 'ERROR');

CREATE TABLE "BotIntegration" (
    "platform" "BotPlatform" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "configured" BOOLEAN NOT NULL DEFAULT false,
    "runtimeStatus" "BotRuntimeStatus" NOT NULL DEFAULT 'DISABLED',
    "botUsername" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BotIntegration_pkey" PRIMARY KEY ("platform")
);

CREATE TABLE "BotChatAllowlist" (
    "id" TEXT NOT NULL,
    "platform" "BotPlatform" NOT NULL,
    "externalChatId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BotChatAllowlist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BotQueryMetric" (
    "id" BIGSERIAL NOT NULL,
    "platform" "BotPlatform" NOT NULL,
    "keyword" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotQueryMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BotChatAllowlist_platform_externalChatId_key" ON "BotChatAllowlist"("platform", "externalChatId");
CREATE INDEX "BotChatAllowlist_platform_active_idx" ON "BotChatAllowlist"("platform", "active");
CREATE INDEX "BotQueryMetric_platform_createdAt_idx" ON "BotQueryMetric"("platform", "createdAt");
CREATE INDEX "BotQueryMetric_createdAt_idx" ON "BotQueryMetric"("createdAt");

INSERT INTO "BotIntegration" ("platform", "enabled", "configured", "runtimeStatus", "updatedAt")
VALUES
  ('TELEGRAM', false, false, 'WAITING_CONFIG', CURRENT_TIMESTAMP),
  ('QQ', false, false, 'WAITING_CONFIG', CURRENT_TIMESTAMP);
