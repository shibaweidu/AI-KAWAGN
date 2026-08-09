CREATE TABLE "SearchAd" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "imageUrl" TEXT,
    "label" TEXT NOT NULL DEFAULT '广告',
    "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "global" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "impressionCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchAd_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SearchAd_active_position_idx" ON "SearchAd"("active", "position");
CREATE INDEX "SearchAd_startsAt_endsAt_idx" ON "SearchAd"("startsAt", "endsAt");
