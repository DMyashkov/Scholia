-- Migration 37: Convert sources from many-to-many (conversation_sources) to one-to-many (sources.conversation_id)
-- Each source belongs to exactly one conversation. No sharing.

-- 1. Add conversation_id to sources (nullable first)
ALTER TABLE sources ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE;

-- 2. Assign each source to its first conversation (for sources in conversation_sources)
UPDATE sources s
SET conversation_id = (
  SELECT cs.conversation_id
  FROM conversation_sources cs
  WHERE cs.source_id = s.id
  ORDER BY cs.conversation_id
  LIMIT 1
)
WHERE conversation_id IS NULL
  AND EXISTS (SELECT 1 FROM conversation_sources cs WHERE cs.source_id = s.id);

-- 3. Duplicate sources that appear in multiple conversations
-- For each (conv_id, source_id) where source.conversation_id != conv_id, create a new source
DO $$
DECLARE
  r RECORD;
  new_id UUID;
BEGIN
  FOR r IN (
    SELECT cs.conversation_id AS conv_id, cs.source_id
    FROM conversation_sources cs
    JOIN sources s ON s.id = cs.source_id
    WHERE s.conversation_id IS DISTINCT FROM cs.conversation_id
  )
  LOOP
    INSERT INTO sources (
      owner_id, url, domain, favicon, crawl_depth, include_subpages, include_pdfs, same_domain_only,
      source_label, conversation_id, created_at, updated_at
    )
    SELECT owner_id, url, domain, favicon, crawl_depth, include_subpages, include_pdfs, same_domain_only,
      source_label, r.conv_id, created_at, NOW()
    FROM sources WHERE id = r.source_id
    RETURNING id INTO new_id;

    -- Update pages
    UPDATE pages SET source_id = new_id WHERE source_id = r.source_id AND conversation_id = r.conv_id;

    -- Update crawl_jobs
    UPDATE crawl_jobs SET source_id = new_id WHERE source_id = r.source_id AND conversation_id = r.conv_id;

    -- Update page_edges
    UPDATE page_edges SET source_id = new_id WHERE source_id = r.source_id AND conversation_id = r.conv_id;

    -- Update discovered_links
    UPDATE discovered_links SET source_id = new_id WHERE source_id = r.source_id AND conversation_id = r.conv_id;

    -- Update add_page_jobs
    UPDATE add_page_jobs SET source_id = new_id WHERE source_id = r.source_id AND conversation_id = r.conv_id;

    -- Update chunks via pages (chunks reference page_id, pages have source_id - already updated pages)
    -- Citations reference page_id - no direct source_id
  END LOOP;
END $$;

-- 4. Delete orphaned sources (no conversation_sources link - shouldn't exist after above, but safety)
DELETE FROM sources WHERE conversation_id IS NULL;

-- 5. Make conversation_id NOT NULL
ALTER TABLE sources ALTER COLUMN conversation_id SET NOT NULL;

-- 6. Replace UNIQUE(owner_id, url) with UNIQUE(conversation_id, url)
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_owner_id_url_key;
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_conversation_url_key;
ALTER TABLE sources ADD CONSTRAINT sources_conversation_url_key UNIQUE (conversation_id, url);

-- 7. Add index on conversation_id
CREATE INDEX IF NOT EXISTS idx_sources_conversation ON sources(conversation_id);

-- 8. Drop conversation_sources
DROP TABLE IF EXISTS conversation_sources;

-- 9. Update RLS for sources: access via conversation ownership
DROP POLICY IF EXISTS "Users can view their own sources" ON sources;
CREATE POLICY "Users can view their own sources"
  ON sources FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = sources.conversation_id
      AND c.owner_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can create sources" ON sources;
CREATE POLICY "Users can create sources"
  ON sources FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = sources.conversation_id
      AND c.owner_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update their own sources" ON sources;
CREATE POLICY "Users can update their own sources"
  ON sources FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = sources.conversation_id
      AND c.owner_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete their own sources" ON sources;
CREATE POLICY "Users can delete their own sources"
  ON sources FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = sources.conversation_id
      AND c.owner_id = (SELECT auth.uid())
    )
  );
