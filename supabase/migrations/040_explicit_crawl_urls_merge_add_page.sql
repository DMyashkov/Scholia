-- Migration 40: Rename seed_urls to explicit_crawl_urls; merge add_page_jobs into crawl_jobs
-- 1. Add 'encoding' to crawl_jobs status (add-page uses indexing -> encoding -> completed)
-- 2. Rename seed_urls -> explicit_crawl_urls
-- 3. Migrate add_page_jobs to crawl_jobs
-- 4. Drop add_page_jobs

-- 1. Add 'encoding' to crawl_jobs status
ALTER TABLE crawl_jobs DROP CONSTRAINT IF EXISTS crawl_jobs_status_check;
ALTER TABLE crawl_jobs ADD CONSTRAINT crawl_jobs_status_check
  CHECK (status IN ('queued', 'running', 'indexing', 'encoding', 'completed', 'failed', 'cancelled'));

-- 2. Rename column
ALTER TABLE crawl_jobs RENAME COLUMN seed_urls TO explicit_crawl_urls;

COMMENT ON COLUMN crawl_jobs.explicit_crawl_urls IS 'When set: crawl these URLs (override source.url). When null: use source.url and discover links. Used for recrawl (all page URLs) and add-page (single URL).';

-- 2. Migrate add_page_jobs to crawl_jobs
-- Get owner_id from sources; map status; explicit_crawl_urls = ARRAY[url]
INSERT INTO crawl_jobs (
  source_id, conversation_id, status, pages_indexed, indexed_count, discovered_count,
  links_count, total_pages, error_message, started_at, completed_at, last_activity_at,
  explicit_crawl_urls, encoding_chunks_done, encoding_chunks_total,
  encoding_discovered_done, encoding_discovered_total, owner_id
)
SELECT
  ap.source_id,
  ap.conversation_id,
  ap.status,
  0,
  0,
  0,
  0,
  NULL,
  ap.error_message,
  CASE WHEN ap.status IN ('indexing','encoding','completed') THEN ap.created_at ELSE NULL END,
  CASE WHEN ap.status IN ('completed','failed') THEN ap.updated_at ELSE NULL END,
  ap.updated_at,
  ARRAY[ap.url]::TEXT[],
  0,
  0,
  0,
  0,
  s.owner_id
FROM add_page_jobs ap
JOIN sources s ON s.id = ap.source_id;

-- 4. Remove add_page_jobs from realtime publication before drop
ALTER PUBLICATION supabase_realtime DROP TABLE add_page_jobs;

-- 4. Drop add_page_jobs
DROP TABLE IF EXISTS add_page_jobs;
