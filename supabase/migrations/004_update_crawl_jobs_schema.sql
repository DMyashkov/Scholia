-- Migration 4: Update crawl_jobs to match requirements
-- Add discovered_count, indexed_count, links_count, last_activity_at

ALTER TABLE crawl_jobs
ADD COLUMN IF NOT EXISTS discovered_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS indexed_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS links_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- Rename pages_indexed to indexed_count for consistency (keep both for backward compat)
-- We'll use indexed_count going forward

-- Update existing rows
UPDATE crawl_jobs
SET 
  discovered_count = COALESCE(total_pages, 0),
  indexed_count = COALESCE(pages_indexed, 0),
  links_count = 0,
  last_activity_at = updated_at
WHERE discovered_count = 0 OR indexed_count = 0;
