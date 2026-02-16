-- Add 'singular' crawl depth: 1 non-dynamic page (seed only)
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_crawl_depth_check;
ALTER TABLE sources ADD CONSTRAINT sources_crawl_depth_check 
  CHECK (crawl_depth IN ('shallow', 'medium', 'deep', 'singular', 'dynamic'));
