ALTER TABLE "ManagedListing"
  ADD COLUMN "modelTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "pricingClaims" TEXT;

ALTER TABLE "GatewayProbeConfig"
  ALTER COLUMN "gatewayId" DROP NOT NULL,
  ADD COLUMN "managedListingId" TEXT;

CREATE UNIQUE INDEX "GatewayProbeConfig_managedListingId_key" ON "GatewayProbeConfig"("managedListingId");

ALTER TABLE "GatewayProbeConfig"
  ADD CONSTRAINT "GatewayProbeConfig_exactly_one_target_check"
  CHECK (("gatewayId" IS NOT NULL)::int + ("managedListingId" IS NOT NULL)::int = 1);

ALTER TABLE "GatewayProbeConfig"
  ADD CONSTRAINT "GatewayProbeConfig_managedListingId_fkey"
  FOREIGN KEY ("managedListingId") REFERENCES "ManagedListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
