CREATE TABLE "SiteSetting" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "siteName" TEXT NOT NULL DEFAULT 'AI卡网',
    "slogan" TEXT NOT NULL DEFAULT 'AICardHub',
    "description" TEXT NOT NULL DEFAULT '聚合授权店铺的公开报价，让数字商品检索与比价更清晰。',
    "seoTitle" TEXT NOT NULL DEFAULT '全网数字商品货源比价',
    "seoDescription" TEXT NOT NULL DEFAULT '聚合已授权数字商店的公开商品与价格，快速比较同款货源。',
    "seoKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "logoObjectKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomeBanner" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "title" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "buttonLabel" TEXT NOT NULL DEFAULT '了解详情',
    "targetUrl" TEXT NOT NULL DEFAULT 'https://example.com',
    "label" TEXT NOT NULL DEFAULT '广告',
    "desktopObjectKey" TEXT,
    "mobileObjectKey" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HomeBanner_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HomeBanner_active_startsAt_endsAt_idx" ON "HomeBanner"("active", "startsAt", "endsAt");

UPDATE "DataSource" SET "name" = '链动小店' WHERE "key" = 'ldxp';
