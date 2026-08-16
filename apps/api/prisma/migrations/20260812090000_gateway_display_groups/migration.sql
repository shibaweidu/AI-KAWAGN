-- CreateTable
CREATE TABLE "GatewayDisplayGroup" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewayDisplayGroup_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "GatewayDirectoryEntry" ADD COLUMN "displayGroupId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GatewayDisplayGroup_key_key" ON "GatewayDisplayGroup"("key");
CREATE INDEX "GatewayDisplayGroup_active_position_idx" ON "GatewayDisplayGroup"("active", "position");
CREATE INDEX "GatewayDirectoryEntry_displayGroupId_active_position_idx" ON "GatewayDirectoryEntry"("displayGroupId", "active", "position");

-- AddForeignKey
ALTER TABLE "GatewayDirectoryEntry" ADD CONSTRAINT "GatewayDirectoryEntry_displayGroupId_fkey" FOREIGN KEY ("displayGroupId") REFERENCES "GatewayDisplayGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SeedData
INSERT INTO "GatewayDisplayGroup" ("id", "key", "name", "position", "active", "updatedAt") VALUES
('gateway-group-stable', 'stable', '稳定生产', 10, true, CURRENT_TIMESTAMP),
('gateway-group-value', 'value', '高性价比', 20, true, CURRENT_TIMESTAMP),
('gateway-group-recent', 'recent', '近期收录', 30, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- InitialGrouping
UPDATE "GatewayDirectoryEntry" SET "displayGroupId" = 'gateway-group-stable' WHERE "sourceSection" = 'premium-stable';
UPDATE "GatewayDirectoryEntry" SET "displayGroupId" = 'gateway-group-value' WHERE "sourceSection" = 'ultra-cheap';
UPDATE "GatewayDirectoryEntry" SET "displayGroupId" = 'gateway-group-recent' WHERE "sourceSection" = 'new';
