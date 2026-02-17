-- Migration 39: Make nullable columns NOT NULL where appropriate
-- (was_multi_step, encoding_*_done all have DEFAULT values and should be NOT NULL)

-- messages.was_multi_step: DEFAULT FALSE, no semantic need for null
UPDATE messages SET was_multi_step = COALESCE(was_multi_step, FALSE) WHERE was_multi_step IS NULL;
ALTER TABLE messages
  ALTER COLUMN was_multi_step SET DEFAULT FALSE,
  ALTER COLUMN was_multi_step SET NOT NULL;

-- crawl_jobs.encoding_chunks_done: DEFAULT 0, progress count always known
UPDATE crawl_jobs SET encoding_chunks_done = COALESCE(encoding_chunks_done, 0) WHERE encoding_chunks_done IS NULL;
ALTER TABLE crawl_jobs
  ALTER COLUMN encoding_chunks_done SET DEFAULT 0,
  ALTER COLUMN encoding_chunks_done SET NOT NULL;

-- crawl_jobs.encoding_discovered_done: DEFAULT 0
UPDATE crawl_jobs SET encoding_discovered_done = COALESCE(encoding_discovered_done, 0) WHERE encoding_discovered_done IS NULL;
ALTER TABLE crawl_jobs
  ALTER COLUMN encoding_discovered_done SET DEFAULT 0,
  ALTER COLUMN encoding_discovered_done SET NOT NULL;

-- add_page_jobs.encoding_chunks_done: DEFAULT 0
UPDATE add_page_jobs SET encoding_chunks_done = COALESCE(encoding_chunks_done, 0) WHERE encoding_chunks_done IS NULL;
ALTER TABLE add_page_jobs
  ALTER COLUMN encoding_chunks_done SET DEFAULT 0,
  ALTER COLUMN encoding_chunks_done SET NOT NULL;

-- add_page_jobs.encoding_discovered_done: DEFAULT 0
UPDATE add_page_jobs SET encoding_discovered_done = COALESCE(encoding_discovered_done, 0) WHERE encoding_discovered_done IS NULL;
ALTER TABLE add_page_jobs
  ALTER COLUMN encoding_discovered_done SET DEFAULT 0,
  ALTER COLUMN encoding_discovered_done SET NOT NULL;
