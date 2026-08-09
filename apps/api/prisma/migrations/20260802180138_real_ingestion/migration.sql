-- CreateEnum
CREATE TYPE "Role" AS ENUM ('BUYER', 'MERCHANT', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DataSourceKind" AS ENUM ('PUBLIC_FEED', 'PUBLIC_DIRECTORY', 'AUTHORIZED_SHOP', 'MANUAL_IMPORT');

-- CreateEnum
CREATE TYPE "CandidateReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MERGED', 'SOURCE_REMOVED');

-- CreateEnum
CREATE TYPE "CollectionMode" AS ENUM ('PUBLIC_FEED', 'PUBLIC_DIRECTORY', 'AUTHORIZED_DIRECT', 'MANUAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'BUYER',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT,
    "homepageUrl" TEXT NOT NULL,
    "adapterKind" TEXT NOT NULL,
    "status" "ShopStatus" NOT NULL DEFAULT 'PENDING',
    "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "verifiedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 80,
    "lastSyncedAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DataSourceKind" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "attributionUrl" TEXT NOT NULL,
    "robotsUrl" TEXT,
    "termsUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "pollIntervalSeconds" INTEGER NOT NULL,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastSnapshotId" TEXT,
    "robotsReviewedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'QUEUED',
    "snapshotId" TEXT,
    "checksum" TEXT,
    "rawSnapshotKey" TEXT,
    "counts" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopCandidate" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "directoryUrl" TEXT NOT NULL,
    "homepageUrl" TEXT,
    "logoUrl" TEXT,
    "sourceListedAt" TIMESTAMP(3),
    "sourceSyncedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "reviewStatus" "CandidateReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "rawMetadata" JSONB,
    "approvedShopId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferCandidate" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "shopCandidateId" TEXT NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "specification" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '其他',
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "stock" INTEGER,
    "stockStatus" TEXT NOT NULL,
    "offerUrl" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "rawMetadata" JSONB,
    "ingestionRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSource" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "collectionMode" "CollectionMode" NOT NULL,
    "attributionLabel" TEXT NOT NULL,
    "authorizationEvidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportChange" (
    "id" BIGSERIAL NOT NULL,
    "ingestionRunId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopClaim" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSubmission" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "authorizationConfirmed" BOOLEAN NOT NULL,
    "status" "ShopStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalProduct" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "categoryId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceProduct" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "canonicalProductId" TEXT,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "categoryHint" TEXT,
    "externalUrl" TEXT NOT NULL,
    "rawSnapshotKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sourceProductId" TEXT NOT NULL,
    "canonicalProductId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "collectionMode" "CollectionMode" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "stock" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sourceUrl" TEXT NOT NULL,
    "sourceObservedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" BIGSERIAL NOT NULL,
    "offerId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "stock" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'QUEUED',
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotKey" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Demand" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "budget" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Demand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "ticket" TEXT NOT NULL,
    "contact" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingSnapshot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "position" INTEGER NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_slug_key" ON "Shop"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_key_key" ON "DataSource"("key");

-- CreateIndex
CREATE INDEX "IngestionRun_dataSourceId_createdAt_idx" ON "IngestionRun"("dataSourceId", "createdAt");

-- CreateIndex
CREATE INDEX "ShopCandidate_reviewStatus_firstSeenAt_idx" ON "ShopCandidate"("reviewStatus", "firstSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopCandidate_dataSourceId_externalId_key" ON "ShopCandidate"("dataSourceId", "externalId");

-- CreateIndex
CREATE INDEX "OfferCandidate_shopCandidateId_active_observedAt_idx" ON "OfferCandidate"("shopCandidateId", "active", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfferCandidate_dataSourceId_externalId_key" ON "OfferCandidate"("dataSourceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSource_dataSourceId_externalId_key" ON "ShopSource"("dataSourceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSource_shopId_dataSourceId_key" ON "ShopSource"("shopId", "dataSourceId");

-- CreateIndex
CREATE INDEX "ImportChange_ingestionRunId_createdAt_idx" ON "ImportChange"("ingestionRunId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopClaim_challenge_key" ON "ShopClaim"("challenge");

-- CreateIndex
CREATE UNIQUE INDEX "ShopClaim_shopId_userId_key" ON "ShopClaim"("shopId", "userId");

-- CreateIndex
CREATE INDEX "ShopSubmission_status_createdAt_idx" ON "ShopSubmission"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalProduct_slug_key" ON "CanonicalProduct"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalProduct_fingerprint_key" ON "CanonicalProduct"("fingerprint");

-- CreateIndex
CREATE INDEX "CanonicalProduct_categoryId_normalizedTitle_idx" ON "CanonicalProduct"("categoryId", "normalizedTitle");

-- CreateIndex
CREATE INDEX "SourceProduct_canonicalProductId_active_idx" ON "SourceProduct"("canonicalProductId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "SourceProduct_shopId_dataSourceId_sourceId_key" ON "SourceProduct"("shopId", "dataSourceId", "sourceId");

-- CreateIndex
CREATE INDEX "Offer_canonicalProductId_active_price_idx" ON "Offer"("canonicalProductId", "active", "price");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_shopId_dataSourceId_externalId_key" ON "Offer"("shopId", "dataSourceId", "externalId");

-- CreateIndex
CREATE INDEX "PriceHistory_offerId_capturedAt_idx" ON "PriceHistory"("offerId", "capturedAt");

-- CreateIndex
CREATE INDEX "SyncRun_shopId_createdAt_idx" ON "SyncRun"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_shopId_status_createdAt_idx" ON "Review"("shopId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_shopId_userId_key" ON "Follow"("shopId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_ticket_key" ON "Feedback"("ticket");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "RankingSnapshot_calculatedAt_position_idx" ON "RankingSnapshot"("calculatedAt", "position");

-- CreateIndex
CREATE INDEX "OutboxEvent_processedAt_createdAt_idx" ON "OutboxEvent"("processedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopCandidate" ADD CONSTRAINT "ShopCandidate_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopCandidate" ADD CONSTRAINT "ShopCandidate_approvedShopId_fkey" FOREIGN KEY ("approvedShopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCandidate" ADD CONSTRAINT "OfferCandidate_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCandidate" ADD CONSTRAINT "OfferCandidate_shopCandidateId_fkey" FOREIGN KEY ("shopCandidateId") REFERENCES "ShopCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCandidate" ADD CONSTRAINT "OfferCandidate_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopSource" ADD CONSTRAINT "ShopSource_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopSource" ADD CONSTRAINT "ShopSource_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportChange" ADD CONSTRAINT "ImportChange_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopClaim" ADD CONSTRAINT "ShopClaim_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopClaim" ADD CONSTRAINT "ShopClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalProduct" ADD CONSTRAINT "CanonicalProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceProduct" ADD CONSTRAINT "SourceProduct_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceProduct" ADD CONSTRAINT "SourceProduct_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceProduct" ADD CONSTRAINT "SourceProduct_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "SourceProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demand" ADD CONSTRAINT "Demand_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
