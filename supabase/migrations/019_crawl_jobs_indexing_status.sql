-- Add 'indexing' to crawl_jobs status so the UI can show indexing progress
ALTER TABLE crawl_jobs DROP CONSTRAINT IF EXISTS crawl_jobs_status_check;
ALTER TABLE crawl_jobs ADD CONSTRAINT crawl_jobs_status_check 
  CHECK (status IN ('queued', 'running', 'indexing', 'completed', 'failed', 'cancelled'));
