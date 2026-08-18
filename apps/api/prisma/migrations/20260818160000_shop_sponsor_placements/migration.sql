-- CreateEnum
CREATE TYPE "SponsorAdKind" AS ENUM ('GATEWAY', 'SHOP');

-- CreateEnum
CREATE TYPE "SponsorPlacementSlotKind" AS ENUM ('GATEWAY', 'SHOP');

-- AlterTable
ALTER TABLE "SponsorAd" ADD COLUMN "kind" "SponsorAdKind" NOT NULL DEFAULT 'GATEWAY';

-- AlterTable
ALTER TABLE "SponsorPlacementSlotConfig" ADD COLUMN "kind" "SponsorPlacementSlotKind" NOT NULL DEFAULT 'GATEWAY';

-- AlterTable
ALTER TABLE "SponsorPlacementCampaign" ALTER COLUMN "managedListingId" DROP NOT NULL;

-- Seed six independently purchasable shop sponsor positions.
INSERT INTO "SponsorPlacementSlotConfig" (
  "id", "key", "kind", "name", "description", "dailyPrice", "minDays", "maxDays", "capacity", "enabled", "position", "createdAt", "updatedAt"
)
SELECT
  'shop-sponsor-slot-' || slot_number,
  'shop_' || slot_number,
  'SHOP'::"SponsorPlacementSlotKind",
  '店铺赞助位 ' || slot_number,
  '展示在全部店铺页面赞助区域第 ' || slot_number || ' 位',
  10.00,
  1,
  30,
  1,
  TRUE,
  slot_number - 1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM generate_series(1, 6) AS slot_number
ON CONFLICT ("key") DO NOTHING;

-- CreateIndex
CREATE INDEX "SponsorPlacementSlotConfig_kind_enabled_position_idx"
ON "SponsorPlacementSlotConfig"("kind", "enabled", "position");
