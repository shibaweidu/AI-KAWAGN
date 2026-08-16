-- Preserve manual assignments and only backfill records that are still unassigned.
UPDATE "GatewayDirectoryEntry" AS entry
SET "displayGroupId" = groups.id
FROM "GatewayDisplayGroup" AS groups
WHERE entry."displayGroupId" IS NULL
  AND groups.key = CASE entry."sourceSection"
    WHEN 'premium-stable' THEN 'stable'
    WHEN 'ultra-cheap' THEN 'value'
    WHEN 'new' THEN 'recent'
    ELSE NULL
  END;
