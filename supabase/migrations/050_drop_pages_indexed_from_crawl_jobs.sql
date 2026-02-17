-- Migration 50: Drop redundant pages_indexed from crawl_jobs (use indexed_count)
ALTER TABLE crawl_jobs DROP COLUMN IF EXISTS pages_indexed;
