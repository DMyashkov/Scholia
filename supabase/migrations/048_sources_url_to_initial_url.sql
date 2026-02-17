-- Migration 48: Rename sources.url to initial_url
-- 1. Drop unique constraint that references url (will be recreated with new column name)
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_conversation_url_key;
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_owner_id_url_key;

-- 2. Rename column
ALTER TABLE sources RENAME COLUMN url TO initial_url;

-- 3. Recreate unique constraint (one source per conversation+URL)
ALTER TABLE sources ADD CONSTRAINT sources_conversation_initial_url_key UNIQUE (conversation_id, initial_url);

-- 4. Update comment on crawl_jobs.explicit_crawl_urls (references source URL)
COMMENT ON COLUMN crawl_jobs.explicit_crawl_urls IS 'When set: crawl these URLs (override source.initial_url). When null: use source.initial_url and discover links. Used for recrawl (all page URLs) and add-page (single URL).';
