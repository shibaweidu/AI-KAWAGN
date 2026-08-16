ALTER TABLE "SiteSetting"
ADD COLUMN "gatewayNoticeTitle" TEXT NOT NULL DEFAULT '使用前请独立核验',
ADD COLUMN "gatewayNoticeDescription" TEXT NOT NULL DEFAULT '建议少额充值，并避免通过第三方服务传输敏感信息。',
ADD COLUMN "gatewayNoticeEnabled" BOOLEAN NOT NULL DEFAULT true;
