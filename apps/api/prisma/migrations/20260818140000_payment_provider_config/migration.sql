-- CreateTable
CREATE TABLE "PaymentProviderConfig" (
    "id" TEXT NOT NULL,
    "apiUrl" TEXT,
    "pid" TEXT,
    "keyCiphertext" TEXT,
    "keyLastFour" TEXT,
    "type" TEXT NOT NULL DEFAULT 'alipay',
    "orderTimeoutMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProviderConfig_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "SponsorPlacementOrder" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- Existing unpaid orders use the initial default timeout.
UPDATE "SponsorPlacementOrder"
SET "expiresAt" = "createdAt" + INTERVAL '30 minutes'
WHERE "status" IN ('PENDING_PAYMENT', 'PAYMENT_PROCESSING') AND "expiresAt" IS NULL;

-- CreateIndex
CREATE INDEX "SponsorPlacementOrder_status_expiresAt_idx" ON "SponsorPlacementOrder"("status", "expiresAt");
