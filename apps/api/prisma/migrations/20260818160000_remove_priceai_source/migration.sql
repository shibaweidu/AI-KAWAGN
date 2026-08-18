-- Remove the deprecated PriceAI sources and their source-owned catalog data.
CREATE TEMP TABLE removed_priceai_sources ON COMMIT DROP AS
SELECT "id"
FROM "DataSource"
WHERE "key" IN ('priceai', 'priceai-cc');

CREATE TEMP TABLE removed_priceai_shops ON COMMIT DROP AS
SELECT DISTINCT "shopId"
FROM "ShopSource"
WHERE "dataSourceId" IN (SELECT "id" FROM removed_priceai_sources);

CREATE TEMP TABLE removed_priceai_canonical_products ON COMMIT DROP AS
SELECT DISTINCT "canonicalProductId"
FROM "Offer"
WHERE "dataSourceId" IN (SELECT "id" FROM removed_priceai_sources)
  AND "canonicalProductId" IS NOT NULL
UNION
SELECT DISTINCT "canonicalProductId"
FROM "SourceProduct"
WHERE "dataSourceId" IN (SELECT "id" FROM removed_priceai_sources)
  AND "canonicalProductId" IS NOT NULL;

CREATE TEMP TABLE removed_priceai_categories ON COMMIT DROP AS
SELECT DISTINCT "categoryId"
FROM "CanonicalProduct"
WHERE "id" IN (SELECT "canonicalProductId" FROM removed_priceai_canonical_products);

CREATE TEMP TABLE removed_priceai_offers ON COMMIT DROP AS
SELECT "id"
FROM "Offer"
WHERE "dataSourceId" IN (SELECT "id" FROM removed_priceai_sources)
   OR "sourceProductId" IN (
     SELECT "id"
     FROM "SourceProduct"
     WHERE "dataSourceId" IN (SELECT "id" FROM removed_priceai_sources)
   );

DELETE FROM "OutboxEvent"
WHERE "topic" = 'offer.updated'
  AND "aggregateId" IN (SELECT "id" FROM removed_priceai_offers);

DELETE FROM "Offer"
WHERE "id" IN (SELECT "id" FROM removed_priceai_offers);

DELETE FROM "SourceProduct"
WHERE "dataSourceId" IN (SELECT "id" FROM removed_priceai_sources);

DELETE FROM "ShopSource"
WHERE "dataSourceId" IN (SELECT "id" FROM removed_priceai_sources);

DELETE FROM "OfferCandidate"
WHERE "dataSourceId" IN (SELECT "id" FROM removed_priceai_sources);

DELETE FROM "IngestionRun"
WHERE "dataSourceId" IN (SELECT "id" FROM removed_priceai_sources);

DELETE FROM "ShopCandidate"
WHERE "dataSourceId" IN (SELECT "id" FROM removed_priceai_sources);

UPDATE "Shop"
SET "status" = 'PAUSED',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "shopId" FROM removed_priceai_shops)
  AND "adapterKind" = 'public-catalog'
  AND NOT EXISTS (
    SELECT 1
    FROM "ShopSource"
    WHERE "ShopSource"."shopId" = "Shop"."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "Offer"
    WHERE "Offer"."shopId" = "Shop"."id"
  );

DELETE FROM "CanonicalProduct"
WHERE "id" IN (SELECT "canonicalProductId" FROM removed_priceai_canonical_products)
  AND NOT EXISTS (
    SELECT 1
    FROM "Offer"
    WHERE "Offer"."canonicalProductId" = "CanonicalProduct"."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "SourceProduct"
    WHERE "SourceProduct"."canonicalProductId" = "CanonicalProduct"."id"
  );

DELETE FROM "Category"
WHERE "id" IN (SELECT "categoryId" FROM removed_priceai_categories)
  AND NOT EXISTS (
    SELECT 1
    FROM "CanonicalProduct"
    WHERE "CanonicalProduct"."categoryId" = "Category"."id"
  );

DELETE FROM "DataSource"
WHERE "id" IN (SELECT "id" FROM removed_priceai_sources);
