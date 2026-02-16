-- encoding_discovered_done/total: progress for embedding discovered_links (dynamic mode suggestions)
-- Distinct from encoding_chunks = page content chunks for RAG search

ALTER TABLE crawl_jobs
ADD COLUMN IF NOT EXISTS encoding_discovered_done INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS encoding_discovered_total INTEGER DEFAULT 0;

ALTER TABLE add_page_jobs
ADD COLUMN IF NOT EXISTS encoding_discovered_done INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS encoding_discovered_total INTEGER DEFAULT 0;
