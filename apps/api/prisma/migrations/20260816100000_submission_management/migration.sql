ALTER TABLE "ShopSubmission"
  ADD COLUMN "publishedShopId" TEXT,
  ADD COLUMN "publishedGatewayId" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "ShopSubmission_deletedAt_createdAt_idx"
  ON "ShopSubmission"("deletedAt", "createdAt");
