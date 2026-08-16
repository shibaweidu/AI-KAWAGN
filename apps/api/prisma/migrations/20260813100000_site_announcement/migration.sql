CREATE TABLE "SiteAnnouncement" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "label" TEXT NOT NULL DEFAULT '公告',
    "content" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteAnnouncement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SiteAnnouncement_enabled_startsAt_endsAt_idx" ON "SiteAnnouncement"("enabled", "startsAt", "endsAt");

INSERT INTO "SiteAnnouncement" ("id", "content", "enabled", "dismissible", "updatedAt")
VALUES ('primary', '[]'::jsonb, false, true, CURRENT_TIMESTAMP);
