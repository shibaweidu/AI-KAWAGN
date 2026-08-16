CREATE TYPE "SubmissionKind" AS ENUM ('SHOP', 'GATEWAY');

ALTER TABLE "ShopSubmission"
  ADD COLUMN "kind" "SubmissionKind" NOT NULL DEFAULT 'SHOP',
  ADD COLUMN "name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "normalizedUrl" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "clientIpHash" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

UPDATE "ShopSubmission" SET "normalizedUrl" = "url" WHERE "normalizedUrl" = '';

CREATE UNIQUE INDEX "ShopSubmission_kind_normalizedUrl_key" ON "ShopSubmission"("kind", "normalizedUrl");
CREATE INDEX "ShopSubmission_kind_status_createdAt_idx" ON "ShopSubmission"("kind", "status", "createdAt");
CREATE INDEX "ShopSubmission_clientIpHash_createdAt_idx" ON "ShopSubmission"("clientIpHash", "createdAt");
