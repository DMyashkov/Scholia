-- Migration 8: Add conversation_id to crawl_jobs for easier lookup
-- File: supabase/migrations/008_add_conversation_id_to_crawl_jobs.sql

-- Add conversation_id to crawl_jobs table
ALTER TABLE crawl_jobs
ADD COLUMN conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE;

-- Update existing crawl_jobs to link to their conversation via conversation_sources
UPDATE crawl_jobs cj
SET conversation_id = (
  SELECT cs.conversation_id 
  FROM conversation_sources cs 
  WHERE cs.source_id = cj.source_id 
  LIMIT 1
)
WHERE conversation_id IS NULL;

-- Delete any orphaned crawl_jobs that couldn't be linked
DELETE FROM crawl_jobs WHERE conversation_id IS NULL;

-- Make conversation_id NOT NULL after cleanup
ALTER TABLE crawl_jobs
ALTER COLUMN conversation_id SET NOT NULL;

-- Add index for performance
CREATE INDEX idx_crawl_jobs_conversation ON crawl_jobs(conversation_id);
