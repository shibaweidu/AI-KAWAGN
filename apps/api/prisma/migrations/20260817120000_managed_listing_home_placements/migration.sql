ALTER TABLE "ManagedListing"
  ADD COLUMN "gatewayPlacement" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "homeSideSlot" "SideAdSlot",
  ADD COLUMN "homeBottomPlacement" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ManagedListing"
SET "gatewayPlacement" = true
WHERE "type" = 'GATEWAY';

CREATE INDEX "ManagedListing_type_active_gatewayPlacement_position_idx"
  ON "ManagedListing"("type", "active", "gatewayPlacement", "position");
CREATE INDEX "ManagedListing_type_active_homeBottomPlacement_position_idx"
  ON "ManagedListing"("type", "active", "homeBottomPlacement", "position");
CREATE INDEX "ManagedListing_type_active_homeSideSlot_idx"
  ON "ManagedListing"("type", "active", "homeSideSlot");
