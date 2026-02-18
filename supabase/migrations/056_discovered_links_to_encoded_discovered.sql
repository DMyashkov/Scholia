-- Migration 56: Rename discovered_links -> encoded_discovered, use page_edge_id FK
-- 1. Ensure every (from_page_id, to_url) in discovered_links has a page_edge (add-page may have inserted discovered_links without page_edges)
-- 2. Create encoded_discovered with page_edge_id
-- 3. Migrate data, drop discovered_links
-- 4. Update RPC, RLS, triggers, realtime

-- =============================================================================
-- 1. Insert missing page_edges for discovered_links that lack one (add-page flow)
-- =============================================================================
INSERT INTO page_edges (from_page_id, to_url, owner_id)
SELECT dl.from_page_id, dl.to_url, dl.owner_id
FROM discovered_links dl
WHERE NOT EXISTS (
  SELECT 1 FROM page_edges pe
  WHERE pe.from_page_id = dl.from_page_id AND pe.to_url = dl.to_url
)
ON CONFLICT (from_page_id, to_url) DO NOTHING;

-- =============================================================================
-- 2. Create encoded_discovered table
-- =============================================================================
CREATE TABLE encoded_discovered (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_edge_id UUID NOT NULL REFERENCES page_edges(id) ON DELETE CASCADE,
  anchor_text TEXT,
  context_snippet TEXT NOT NULL,
  embedding extensions.vector(1536),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(page_edge_id)
);

CREATE INDEX IF NOT EXISTS idx_encoded_discovered_page_edge ON encoded_discovered(page_edge_id);
CREATE INDEX IF NOT EXISTS idx_encoded_discovered_embedding ON encoded_discovered
  USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;

ALTER TABLE encoded_discovered ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3. Migrate data from discovered_links to encoded_discovered
-- =============================================================================
INSERT INTO encoded_discovered (page_edge_id, anchor_text, context_snippet, embedding, owner_id, created_at)
SELECT
  pe.id,
  dl.anchor_text,
  dl.context_snippet,
  dl.embedding,
  dl.owner_id,
  COALESCE(dl.created_at, now())
FROM discovered_links dl
JOIN page_edges pe ON pe.from_page_id = dl.from_page_id AND pe.to_url = dl.to_url
ON CONFLICT (page_edge_id) DO NOTHING;

-- =============================================================================
-- 4. Drop discovered_links (policies, trigger, realtime, table)
-- =============================================================================
DROP POLICY IF EXISTS "Users can view discovered_links from their pages" ON discovered_links;
DROP POLICY IF EXISTS "Users can insert discovered_links" ON discovered_links;
DROP POLICY IF EXISTS "Users can update discovered_links" ON discovered_links;
DROP POLICY IF EXISTS "Users can delete discovered_links from their pages" ON discovered_links;
DROP TRIGGER IF EXISTS set_discovered_links_owner ON discovered_links;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'discovered_links'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE discovered_links;
  END IF;
END
$$;

DROP TABLE discovered_links;

-- =============================================================================
-- 5. Create encoded_discovered RLS policies
-- =============================================================================
CREATE POLICY "Users can view encoded_discovered from their pages"
  ON encoded_discovered FOR SELECT
  USING (
    owner_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM page_edges pe
      JOIN pages p ON p.id = pe.from_page_id
      JOIN sources s ON s.id = p.source_id
      JOIN conversations c ON c.id = s.conversation_id
      WHERE pe.id = encoded_discovered.page_edge_id AND c.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert encoded_discovered"
  ON encoded_discovered FOR INSERT
  WITH CHECK (
    owner_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM page_edges pe
      JOIN pages p ON p.id = pe.from_page_id
      JOIN sources s ON s.id = p.source_id
      JOIN conversations c ON c.id = s.conversation_id
      WHERE pe.id = encoded_discovered.page_edge_id AND c.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update encoded_discovered"
  ON encoded_discovered FOR UPDATE
  USING (
    owner_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM page_edges pe
      JOIN pages p ON p.id = pe.from_page_id
      JOIN sources s ON s.id = p.source_id
      JOIN conversations c ON c.id = s.conversation_id
      WHERE pe.id = encoded_discovered.page_edge_id AND c.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete encoded_discovered from their pages"
  ON encoded_discovered FOR DELETE
  USING (
    owner_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM page_edges pe
      JOIN pages p ON p.id = pe.from_page_id
      JOIN sources s ON s.id = p.source_id
      JOIN conversations c ON c.id = s.conversation_id
      WHERE pe.id = encoded_discovered.page_edge_id AND c.owner_id = auth.uid()
    )
  );

-- =============================================================================
-- 6. Trigger for owner_id (encoded_discovered has owner_id, set on insert if null)
-- =============================================================================
CREATE OR REPLACE FUNCTION set_encoded_discovered_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    NEW.owner_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_encoded_discovered_owner
  BEFORE INSERT ON encoded_discovered
  FOR EACH ROW
  EXECUTE FUNCTION set_encoded_discovered_owner();

-- =============================================================================
-- 7. Replace match_discovered_links RPC to use encoded_discovered + page_edges
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
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ed.id,
    pe.to_url,
    ed.anchor_text,
    ed.context_snippet,
    p.source_id,
    pe.from_page_id,
    (ed.embedding <=> query_embedding)::float AS distance
  FROM encoded_discovered ed
  JOIN page_edges pe ON pe.id = ed.page_edge_id
  JOIN pages p ON p.id = pe.from_page_id
  WHERE p.source_id = ANY(match_source_ids)
    AND ed.embedding IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pages p2
      WHERE p2.source_id = p.source_id AND p2.url = pe.to_url
    )
  ORDER BY ed.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- =============================================================================
-- 8. Add encoded_discovered to realtime
-- =============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE encoded_discovered;
