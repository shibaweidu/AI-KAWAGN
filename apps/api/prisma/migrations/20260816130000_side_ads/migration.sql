CREATE TYPE "SideAdSlot" AS ENUM ('LEFT', 'RIGHT');

CREATE TABLE "SideAd" (
  "id" TEXT NOT NULL,
  "slot" "SideAdSlot" NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "url" TEXT NOT NULL DEFAULT 'https://example.com',
  "imageUrl" TEXT,
  "imageObjectKey" TEXT,
  "label" TEXT NOT NULL DEFAULT '广告',
  "active" BOOLEAN NOT NULL DEFAULT false,
  "impressionCount" INTEGER NOT NULL DEFAULT 0,
  "clickCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SideAd_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SideAd_slot_key" ON "SideAd"("slot");
CREATE INDEX "SideAd_active_slot_idx" ON "SideAd"("active", "slot");
