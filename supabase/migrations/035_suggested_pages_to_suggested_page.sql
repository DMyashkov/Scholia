-- Migration 35: Rename suggested_pages (array) to suggested_page (single object)
-- Convert existing array data: take first element

-- Add new column
ALTER TABLE messages ADD COLUMN IF NOT EXISTS suggested_page JSONB DEFAULT NULL;

-- Migrate: if suggested_pages is array with items, take first; else null
UPDATE messages
SET suggested_page = CASE
  WHEN suggested_pages IS NULL THEN NULL
  WHEN jsonb_typeof(suggested_pages) = 'array' AND jsonb_array_length(suggested_pages) > 0
    THEN suggested_pages->0
  WHEN jsonb_typeof(suggested_pages) = 'object' THEN suggested_pages
  ELSE NULL
END
WHERE suggested_pages IS NOT NULL;

-- Drop old column
ALTER TABLE messages DROP COLUMN IF EXISTS suggested_pages;
