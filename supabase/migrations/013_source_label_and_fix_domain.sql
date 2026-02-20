-- Add source_label for human-readable display (e.g. page or site name). Keep domain as hostname (e.g. example.com).
ALTER TABLE sources ADD COLUMN IF NOT EXISTS source_label TEXT;

-- Fix sources where domain was overwritten with page title (contains spaces or looks like a title).
-- Restore domain from the source URL's hostname.
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
