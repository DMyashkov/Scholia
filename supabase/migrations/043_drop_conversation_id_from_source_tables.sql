-- Migration 43: Drop conversation_id from tables that have source_id
-- Sources are one-to-many with conversations; derive conversation via source_id -> sources.conversation_id

-- =============================================================================
-- 1. Drop RLS policies that depend on conversation_id (before dropping column)
-- =============================================================================

-- pages
DROP POLICY IF EXISTS "Users can view pages from their conversations" ON pages;
DROP POLICY IF EXISTS "Users can create pages" ON pages;
DROP POLICY IF EXISTS "Users can delete pages from their conversations" ON pages;

-- crawl_jobs: policies use owner_id only, no conversation_id
-- (keep as-is; we just drop the column)

-- chunks: DELETE policy uses p.conversation_id
DROP POLICY IF EXISTS "Users can delete chunks from their conversation pages" ON chunks;

-- discovered_links
DROP POLICY IF EXISTS "Users can view discovered_links from their conversations" ON discovered_links;
DROP POLICY IF EXISTS "Users can insert discovered_links" ON discovered_links;
DROP POLICY IF EXISTS "Users can update discovered_links" ON discovered_links;
DROP POLICY IF EXISTS "Users can delete discovered_links from their conversations" ON discovered_links;

-- =============================================================================
-- 2. Update unique constraints and indexes before dropping columns
-- =============================================================================

-- pages: (conversation_id, source_id, url) -> (source_id, url)
ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_conversation_source_url_key;
ALTER TABLE pages ADD CONSTRAINT pages_source_url_key UNIQUE (source_id, url);

-- discovered_links: (conversation_id, source_id, to_url) -> (source_id, to_url)
ALTER TABLE discovered_links DROP CONSTRAINT IF EXISTS discovered_links_conversation_id_source_id_to_url_key;
ALTER TABLE discovered_links DROP CONSTRAINT IF EXISTS discovered_links_source_id_to_url_key;
ALTER TABLE discovered_links ADD CONSTRAINT discovered_links_source_to_url_key UNIQUE (source_id, to_url);

-- =============================================================================
-- 3. Drop conversation_id column and related indexes
-- =============================================================================

ALTER TABLE pages DROP COLUMN IF EXISTS conversation_id;
DROP INDEX IF EXISTS idx_pages_conversation;

ALTER TABLE crawl_jobs DROP COLUMN IF EXISTS conversation_id;
DROP INDEX IF EXISTS idx_crawl_jobs_conversation;

ALTER TABLE discovered_links DROP COLUMN IF EXISTS conversation_id;
DROP INDEX IF EXISTS idx_discovered_links_conversation;

-- =============================================================================
-- 4. Recreate RLS policies (derive ownership via source_id -> sources -> conversations)
-- =============================================================================

-- pages
CREATE POLICY "Users can view pages from their sources"
  ON pages FOR SELECT
  USING (
    owner_id = (SELECT auth.uid()) AND
    EXISTS (
      SELECT 1 FROM sources s
      JOIN conversations c ON c.id = s.conversation_id
      WHERE s.id = pages.source_id AND c.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can create pages"
  ON pages FOR INSERT
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete pages from their sources"
  ON pages FOR DELETE
  USING (
    owner_id = (SELECT auth.uid()) AND
    EXISTS (
      SELECT 1 FROM sources s
      JOIN conversations c ON c.id = s.conversation_id
      WHERE s.id = pages.source_id AND c.owner_id = (SELECT auth.uid())
    )
  );

-- chunks (DELETE: derive via pages -> sources -> conversations)
CREATE POLICY "Users can delete chunks from their conversation pages"
  ON chunks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM pages p
      JOIN sources s ON s.id = p.source_id
      JOIN conversations c ON c.id = s.conversation_id
      WHERE p.id = chunks.page_id AND c.owner_id = (SELECT auth.uid())
    )
  );

-- discovered_links
CREATE POLICY "Users can view discovered_links from their sources"
  ON discovered_links FOR SELECT
  USING (
    owner_id = (SELECT auth.uid()) AND
    EXISTS (
      SELECT 1 FROM sources s
      JOIN conversations c ON c.id = s.conversation_id
      WHERE s.id = discovered_links.source_id AND c.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert discovered_links"
  ON discovered_links FOR INSERT
  WITH CHECK (
    owner_id = (SELECT auth.uid()) AND
    EXISTS (
      SELECT 1 FROM sources s
      JOIN conversations c ON c.id = s.conversation_id
      WHERE s.id = discovered_links.source_id AND c.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update discovered_links"
  ON discovered_links FOR UPDATE
  USING (
    owner_id = (SELECT auth.uid()) AND
    EXISTS (
      SELECT 1 FROM sources s
      JOIN conversations c ON c.id = s.conversation_id
      WHERE s.id = discovered_links.source_id AND c.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete discovered_links from their sources"
  ON discovered_links FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM sources s
      JOIN conversations c ON c.id = s.conversation_id
      WHERE s.id = discovered_links.source_id AND c.owner_id = (SELECT auth.uid())
    )
  );

-- =============================================================================
-- 5. Update match_discovered_links RPC: drop conversation_id param, filter by source_ids only
-- =============================================================================

CREATE OR REPLACE FUNCTION match_discovered_links(
  query_embedding vector(1536),
  match_source_ids uuid[],
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  to_url text,
  anchor_text text,
  context_snippet text,
  source_id uuid,
  from_page_id uuid,
  distance float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dl.id,
    dl.to_url,
    dl.anchor_text,
    dl.context_snippet,
    dl.source_id,
    dl.from_page_id,
    (dl.embedding <=> query_embedding)::float AS distance
  FROM discovered_links dl
  WHERE dl.source_id = ANY(match_source_ids)
    AND dl.embedding IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pages p
      WHERE p.source_id = dl.source_id AND p.url = dl.to_url
    )
  ORDER BY dl.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION match_discovered_links(vector(1536), uuid[], int) TO authenticated;
GRANT EXECUTE ON FUNCTION match_discovered_links(vector(1536), uuid[], int) TO service_role;
REVOKE EXECUTE ON FUNCTION match_discovered_links(vector(1536), uuid[], int) FROM anon;
