-- Product media is optional because the current LDXP snapshot does not always expose images.
ALTER TABLE "CanonicalProduct" ADD COLUMN "thumbnailUrl" TEXT;
ALTER TABLE "SourceProduct" ADD COLUMN "thumbnailUrl" TEXT;

CREATE TYPE "ManagedListingType" AS ENUM ('GATEWAY', 'PROJECT');

CREATE TABLE "ManagedListing" (
    "id" TEXT NOT NULL,
    "type" "ManagedListingType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "badge" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagedListing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManagedListing_type_active_position_idx" ON "ManagedListing"("type", "active", "position");

-- Every published merchant in AI卡网 is platform-verified.
UPDATE "Shop"
SET "verifiedAt" = COALESCE("verifiedAt", CURRENT_TIMESTAMP)
WHERE "status" = 'ACTIVE' AND "publishedAt" IS NOT NULL;
