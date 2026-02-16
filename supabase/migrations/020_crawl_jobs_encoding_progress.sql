-- Add encoding progress columns for RAG indexing feedback
ALTER TABLE crawl_jobs
ADD COLUMN IF NOT EXISTS encoding_chunks_done INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS encoding_chunks_total INTEGER DEFAULT 0;
