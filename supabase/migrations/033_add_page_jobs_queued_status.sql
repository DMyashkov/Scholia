-- Add 'queued' status so worker can claim add_page_jobs (Edge Function creates, worker processes)
ALTER TABLE add_page_jobs DROP CONSTRAINT IF EXISTS add_page_jobs_status_check;
ALTER TABLE add_page_jobs ADD CONSTRAINT add_page_jobs_status_check 
  CHECK (status IN ('queued', 'indexing', 'encoding', 'completed', 'failed'));
