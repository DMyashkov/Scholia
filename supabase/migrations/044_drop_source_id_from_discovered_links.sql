-- Migration 44: Drop source_id from discovered_links (infer from from_page_id via pages)

-- =============================================================================
-- 1. Drop RLS policies that reference source_id
-- =============================================================================

DROP POLICY IF EXISTS "Users can view discovered_links from their sources" ON discovered_links;
DROP POLICY IF EXISTS "Users can insert discovered_links" ON discovered_links;
DROP POLICY IF EXISTS "Users can update discovered_links" ON discovered_links;
DROP POLICY IF EXISTS "Users can delete discovered_links from their sources" ON discovered_links;

-- =============================================================================
-- 2. Update unique constraint: (source_id, to_url) -> (from_page_id, to_url)
-- =============================================================================

ALTER TABLE discovered_links DROP CONSTRAINT IF EXISTS discovered_links_source_to_url_key;
ALTER TABLE discovered_links DROP CONSTRAINT IF EXISTS discovered_links_source_id_to_url_key;
ALTER TABLE discovered_links ADD CONSTRAINT discovered_links_from_page_to_url_key UNIQUE (from_page_id, to_url);

-- =============================================================================
-- 3. Drop source_id column and index
-- =============================================================================

ALTER TABLE discovered_links DROP COLUMN IF EXISTS source_id;
DROP INDEX IF EXISTS idx_discovered_links_source;

-- =============================================================================
-- 4. Recreate RLS policies (derive via from_page_id -> pages -> sources -> conversations)
-- =============================================================================

CREATE POLICY "Users can view discovered_links from their pages"
  ON discovered_links FOR SELECT
  USING (
    owner_id = (SELECT auth.uid()) AND
    EXISTS (
      SELECT 1 FROM pages p
      JOIN sources s ON s.id = p.source_id
      JOIN conversations c ON c.id = s.conversation_id
      WHERE p.id = discovered_links.from_page_id AND c.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert discovered_links"
  ON discovered_links FOR INSERT
  WITH CHECK (
    owner_id = (SELECT auth.uid()) AND
    EXISTS (
      SELECT 1 FROM pages p
      JOIN sources s ON s.id = p.source_id
      JOIN conversations c ON c.id = s.conversation_id
      WHERE p.id = discovered_links.from_page_id AND c.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update discovered_links"
  ON discovered_links FOR UPDATE
  USING (
    owner_id = (SELECT auth.uid()) AND
    EXISTS (
      SELECT 1 FROM pages p
      JOIN sources s ON s.id = p.source_id
      JOIN conversations c ON c.id = s.conversation_id
      WHERE p.id = discovered_links.from_page_id AND c.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete discovered_links from their pages"
  ON discovered_links FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM pages p
      JOIN sources s ON s.id = p.source_id
      JOIN conversations c ON c.id = s.conversation_id
      WHERE p.id = discovered_links.from_page_id AND c.owner_id = (SELECT auth.uid())
    )
  );

-- =============================================================================
-- 5. Update match_discovered_links RPC: filter via from_page_id -> pages.source_id
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
    p.source_id,
    dl.from_page_id,
    (dl.embedding <=> query_embedding)::float AS distance
  FROM discovered_links dl
  JOIN pages p ON p.id = dl.from_page_id
  WHERE p.source_id = ANY(match_source_ids)
    AND dl.embedding IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pages p2
      WHERE p2.source_id = p.source_id AND p2.url = dl.to_url
    )
  ORDER BY dl.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
