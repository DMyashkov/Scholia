-- Migration 47: Drop links_count from crawl_jobs (legacy, no longer set)
ALTER TABLE crawl_jobs DROP COLUMN IF EXISTS links_count;
