UPDATE "DataSource"
SET "kind" = 'PUBLIC_DIRECTORY', "attributionUrl" = 'https://211b.site/shops'
WHERE "key" = 'ldxp';

UPDATE "ShopCandidate" AS candidate
SET "directoryUrl" = 'https://211b.site/shops/' || candidate."externalId"
FROM "DataSource" AS source
WHERE candidate."dataSourceId" = source."id"
  AND source."key" = 'ldxp'
  AND candidate."rawMetadata"->>'discoverySource' = '211b.site';

UPDATE "ShopSource" AS mapping
SET "collectionMode" = 'PUBLIC_DIRECTORY'
FROM "DataSource" AS source
WHERE mapping."dataSourceId" = source."id"
  AND source."key" = 'ldxp';

UPDATE "Offer" AS offer
SET
  "collectionMode" = 'PUBLIC_DIRECTORY',
  "sourceAttributionUrl" = 'https://211b.site/shops/' || mapping."externalId"
FROM "ShopSource" AS mapping, "DataSource" AS source
WHERE offer."shopId" = mapping."shopId"
  AND offer."dataSourceId" = source."id"
  AND mapping."dataSourceId" = source."id"
  AND source."key" = 'ldxp';
