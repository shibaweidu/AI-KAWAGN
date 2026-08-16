CREATE TYPE "GatewayReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DUPLICATE', 'SOURCE_REMOVED');

CREATE TABLE "GatewayDirectoryEntry" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceSiteId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sourceSection" TEXT NOT NULL DEFAULT 'all',
    "sourcePosition" INTEGER,
    "sourceRedirectUrl" TEXT NOT NULL,
    "destinationUrl" TEXT,
    "destinationHost" TEXT,
    "providerType" TEXT NOT NULL DEFAULT '第三方',
    "logoUrl" TEXT,
    "sponsored" BOOLEAN NOT NULL DEFAULT false,
    "online" BOOLEAN,
    "upVotes" INTEGER NOT NULL DEFAULT 0,
    "downVotes" INTEGER NOT NULL DEFAULT 0,
    "availability7d" DOUBLE PRECISION,
    "averageResponseMs" INTEGER,
    "modelTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pricingClaims" TEXT,
    "reviewStatus" "GatewayReviewStatus" NOT NULL DEFAULT 'PENDING',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUpdatedAt" TIMESTAMP(3),
    "rawMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GatewayDirectoryEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GatewayDirectorySyncRun" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "mode" TEXT NOT NULL,
    "completeFeed" BOOLEAN NOT NULL DEFAULT false,
    "counts" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GatewayDirectorySyncRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GatewayDirectoryEntry_slug_key" ON "GatewayDirectoryEntry"("slug");
CREATE UNIQUE INDEX "GatewayDirectoryEntry_sourceKey_sourceSiteId_key" ON "GatewayDirectoryEntry"("sourceKey", "sourceSiteId");
CREATE INDEX "GatewayDirectoryEntry_reviewStatus_active_updatedAt_idx" ON "GatewayDirectoryEntry"("reviewStatus", "active", "updatedAt");
CREATE INDEX "GatewayDirectoryEntry_sourceSection_active_position_idx" ON "GatewayDirectoryEntry"("sourceSection", "active", "position");
CREATE INDEX "GatewayDirectoryEntry_destinationHost_idx" ON "GatewayDirectoryEntry"("destinationHost");
CREATE INDEX "GatewayDirectoryEntry_featured_active_position_idx" ON "GatewayDirectoryEntry"("featured", "active", "position");
CREATE INDEX "GatewayDirectorySyncRun_sourceKey_createdAt_idx" ON "GatewayDirectorySyncRun"("sourceKey", "createdAt");
CREATE INDEX "GatewayDirectorySyncRun_status_createdAt_idx" ON "GatewayDirectorySyncRun"("status", "createdAt");
