-- Migration 5: Update page_edges to use URLs instead of page_ids
-- Add from_url and to_url columns

ALTER TABLE page_edges
ADD COLUMN IF NOT EXISTS from_url TEXT,
ADD COLUMN IF NOT EXISTS to_url TEXT;

-- Populate URLs from pages table for existing edges
UPDATE page_edges pe
SET 
  from_url = p1.url,
  to_url = p2.url
FROM pages p1, pages p2
WHERE pe.from_page_id = p1.id AND pe.to_page_id = p2.id;

-- Make URLs required going forward (but allow null for existing data)
-- We'll use URL-based edges for new inserts
