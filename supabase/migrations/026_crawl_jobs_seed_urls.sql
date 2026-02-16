-- Add seed_urls to crawl_jobs for recrawl of dynamic sources (multiple starting URLs)
ALTER TABLE crawl_jobs
ADD COLUMN IF NOT EXISTS seed_urls TEXT[] DEFAULT NULL;

COMMENT ON COLUMN crawl_jobs.seed_urls IS 'Optional override: for recrawl of dynamic sources, URLs of all pages to re-crawl. If null, worker uses source.url as single seed.';
