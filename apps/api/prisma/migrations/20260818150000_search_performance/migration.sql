CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Shop_status_publishedAt_id_idx"
  ON "Shop" ("status", "publishedAt", "id");

CREATE INDEX IF NOT EXISTS "Shop_lastSyncedAt_status_idx"
  ON "Shop" ("lastSyncedAt", "status");

CREATE INDEX IF NOT EXISTS "Offer_active_syncedAt_idx"
  ON "Offer" ("active", "syncedAt");

CREATE INDEX IF NOT EXISTS "Offer_shopId_canonicalProductId_active_sourceObservedAt_idx"
  ON "Offer" ("shopId", "canonicalProductId", "active", "sourceObservedAt" DESC);

CREATE INDEX IF NOT EXISTS "CanonicalProduct_title_trgm_idx"
  ON "CanonicalProduct" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Shop_name_description_trgm_idx"
  ON "Shop" USING GIN (("name" || ' ' || "description") gin_trgm_ops);
