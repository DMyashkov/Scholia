-- Add source_label for human-readable display (e.g. "Joe Biden"). Keep domain as hostname (e.g. en.wikipedia.org).
ALTER TABLE sources ADD COLUMN IF NOT EXISTS source_label TEXT;

-- Preserve corrupted domain (page title like "Joe Biden") as source_label before we overwrite it.
UPDATE sources
SET source_label = COALESCE(NULLIF(TRIM(source_label), ''), domain)
WHERE (domain ~ '\s' OR LENGTH(domain) > 63)
  AND (source_label IS NULL OR source_label = '');

-- Fix sources where domain was overwritten with page title. Restore domain from the source URL's hostname.
UPDATE sources
SET domain = LOWER(
  REGEXP_REPLACE(
    SUBSTRING(url FROM '^https?://([^/]+)'),
    '^www\.',
    ''
  )
)
WHERE domain ~ '\s'  -- domain contains space (e.g. "President of the United States")
   OR LENGTH(domain) > 63;  -- hostnames are max 253, typical are shorter
