-- Add encoding progress columns to add_page_jobs (mirrors crawl_jobs)
ALTER TABLE add_page_jobs
ADD COLUMN IF NOT EXISTS encoding_chunks_done INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS encoding_chunks_total INTEGER DEFAULT 0;
