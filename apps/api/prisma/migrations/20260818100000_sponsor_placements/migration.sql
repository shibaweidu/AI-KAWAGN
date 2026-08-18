CREATE TYPE "SponsorAdStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PAID_PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "SponsorPlacementOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAID_PENDING_REVIEW', 'APPROVED', 'REJECTED', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED');
CREATE TYPE "SponsorPlacementCampaignStatus" AS ENUM ('SCHEDULED', 'RUNNING', 'EXPIRED', 'CANCELLED');

ALTER TABLE "ManagedListing" ADD COLUMN "ownerUserId" TEXT;
CREATE INDEX "ManagedListing_ownerUserId_active_idx" ON "ManagedListing"("ownerUserId", "active");
ALTER TABLE "ManagedListing" ADD CONSTRAINT "ManagedListing_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SponsorAd" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "url" TEXT NOT NULL,
  "badge" TEXT,
  "modelTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "pricingClaims" TEXT,
  "imageUrl" TEXT,
  "imageObjectKey" TEXT,
  "status" "SponsorAdStatus" NOT NULL DEFAULT 'DRAFT',
  "rejectionReason" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "managedListingId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SponsorAd_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SponsorAd_managedListingId_key" ON "SponsorAd"("managedListingId");
CREATE INDEX "SponsorAd_userId_status_createdAt_idx" ON "SponsorAd"("userId", "status", "createdAt");
CREATE INDEX "SponsorAd_status_updatedAt_idx" ON "SponsorAd"("status", "updatedAt");
ALTER TABLE "SponsorAd" ADD CONSTRAINT "SponsorAd_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SponsorAd" ADD CONSTRAINT "SponsorAd_managedListingId_fkey" FOREIGN KEY ("managedListingId") REFERENCES "ManagedListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SponsorPlacementSlotConfig" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "dailyPrice" DECIMAL(12,2) NOT NULL,
  "minDays" INTEGER NOT NULL DEFAULT 1,
  "maxDays" INTEGER NOT NULL DEFAULT 30,
  "capacity" INTEGER NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SponsorPlacementSlotConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SponsorPlacementSlotConfig_key_key" ON "SponsorPlacementSlotConfig"("key");
CREATE INDEX "SponsorPlacementSlotConfig_enabled_position_idx" ON "SponsorPlacementSlotConfig"("enabled", "position");

CREATE TABLE "SponsorPlacementOrder" (
  "id" TEXT NOT NULL,
  "orderNo" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sponsorAdId" TEXT NOT NULL,
  "status" "SponsorPlacementOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "totalAmount" DECIMAL(12,2) NOT NULL,
  "paymentChannel" TEXT,
  "transactionId" TEXT,
  "paymentNotifiedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SponsorPlacementOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SponsorPlacementOrder_orderNo_key" ON "SponsorPlacementOrder"("orderNo");
CREATE INDEX "SponsorPlacementOrder_userId_createdAt_idx" ON "SponsorPlacementOrder"("userId", "createdAt");
CREATE INDEX "SponsorPlacementOrder_status_createdAt_idx" ON "SponsorPlacementOrder"("status", "createdAt");
ALTER TABLE "SponsorPlacementOrder" ADD CONSTRAINT "SponsorPlacementOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SponsorPlacementOrder" ADD CONSTRAINT "SponsorPlacementOrder_sponsorAdId_fkey" FOREIGN KEY ("sponsorAdId") REFERENCES "SponsorAd"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SponsorPlacementOrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "slotConfigId" TEXT NOT NULL,
  "slotKey" TEXT NOT NULL,
  "dailyPrice" DECIMAL(12,2) NOT NULL,
  "days" INTEGER NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  CONSTRAINT "SponsorPlacementOrderItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SponsorPlacementOrderItem_orderId_slotKey_key" ON "SponsorPlacementOrderItem"("orderId", "slotKey");
CREATE INDEX "SponsorPlacementOrderItem_slotKey_startsAt_endsAt_idx" ON "SponsorPlacementOrderItem"("slotKey", "startsAt", "endsAt");
ALTER TABLE "SponsorPlacementOrderItem" ADD CONSTRAINT "SponsorPlacementOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SponsorPlacementOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SponsorPlacementOrderItem" ADD CONSTRAINT "SponsorPlacementOrderItem_slotConfigId_fkey" FOREIGN KEY ("slotConfigId") REFERENCES "SponsorPlacementSlotConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SponsorPlacementCampaign" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "managedListingId" TEXT NOT NULL,
  "slotKey" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" "SponsorPlacementCampaignStatus" NOT NULL DEFAULT 'SCHEDULED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SponsorPlacementCampaign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SponsorPlacementCampaign_orderItemId_key" ON "SponsorPlacementCampaign"("orderItemId");
CREATE INDEX "SponsorPlacementCampaign_slotKey_status_startsAt_endsAt_idx" ON "SponsorPlacementCampaign"("slotKey", "status", "startsAt", "endsAt");
CREATE INDEX "SponsorPlacementCampaign_endsAt_status_idx" ON "SponsorPlacementCampaign"("endsAt", "status");
ALTER TABLE "SponsorPlacementCampaign" ADD CONSTRAINT "SponsorPlacementCampaign_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SponsorPlacementOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SponsorPlacementCampaign" ADD CONSTRAINT "SponsorPlacementCampaign_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "SponsorPlacementOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SponsorPlacementCampaign" ADD CONSTRAINT "SponsorPlacementCampaign_managedListingId_fkey" FOREIGN KEY ("managedListingId") REFERENCES "ManagedListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "SponsorPlacementSlotConfig" ("id", "key", "name", "description", "dailyPrice", "minDays", "maxDays", "capacity", "enabled", "position", "updatedAt") VALUES
  ('placement-slot-gateway', 'gateway', '中转站目录', '展示在中转站赞助商目录', 20, 1, 30, 10, true, 0, CURRENT_TIMESTAMP),
  ('placement-slot-home-left', 'home_left', '首页左侧', '首页左侧固定广告位', 10, 1, 30, 1, true, 1, CURRENT_TIMESTAMP),
  ('placement-slot-home-right', 'home_right', '首页右侧', '首页右侧固定广告位', 10, 1, 30, 1, true, 2, CURRENT_TIMESTAMP),
  ('placement-slot-home-bottom', 'home_bottom', '首页底部', '首页底部赞助商区域', 15, 1, 30, 10, true, 3, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
