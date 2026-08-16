ALTER TABLE "OfferCandidate" ADD COLUMN "sourceAttributionUrl" TEXT;
ALTER TABLE "Offer" ADD COLUMN "sourceAttributionUrl" TEXT;

CREATE TABLE "OutboundClick" (
    "id" BIGSERIAL NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "destinationHost" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundClick_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OutboundClick_targetType_targetId_createdAt_idx" ON "OutboundClick"("targetType", "targetId", "createdAt");
CREATE INDEX "OutboundClick_createdAt_idx" ON "OutboundClick"("createdAt");
