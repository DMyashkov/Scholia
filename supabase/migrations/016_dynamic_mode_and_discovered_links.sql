-- Migration 16: Dynamic mode - add 'dynamic' crawl depth and discovered_links table

-- 1. Add 'dynamic' to sources.crawl_depth
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_crawl_depth_check;
ALTER TABLE sources ADD CONSTRAINT sources_crawl_depth_check 
  CHECK (crawl_depth IN ('shallow', 'medium', 'deep', 'dynamic'));

-- 2. Add dynamic_mode to conversations (on by default)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS dynamic_mode BOOLEAN NOT NULL DEFAULT true;

-- 3. discovered_links: links from seed page with context for RAG suggestion
-- Only used when source is dynamic. Embedding = first 200 chars of context around link.
CREATE TABLE IF NOT EXISTS discovered_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  from_page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  to_url TEXT NOT NULL,
  anchor_text TEXT,
  context_snippet TEXT NOT NULL,
  embedding VECTOR(1536),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(conversation_id, source_id, to_url)
);

CREATE INDEX IF NOT EXISTS idx_discovered_links_conversation ON discovered_links(conversation_id);
CREATE INDEX IF NOT EXISTS idx_discovered_links_source ON discovered_links(source_id);
CREATE INDEX IF NOT EXISTS idx_discovered_links_embedding ON discovered_links 
  USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;

-- RLS
ALTER TABLE discovered_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view discovered_links from their conversations"
  ON discovered_links FOR SELECT
  USING (
    (owner_id = auth.uid() OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = discovered_links.conversation_id
      AND (conversations.owner_id = auth.uid() OR conversations.owner_id IS NULL)
    )
  );
CREATE POLICY "Users can insert discovered_links"
  ON discovered_links FOR INSERT
  WITH CHECK (
    (owner_id = auth.uid() OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = discovered_links.conversation_id
      AND (conversations.owner_id = auth.uid() OR conversations.owner_id IS NULL)
    )
  );
CREATE POLICY "Users can update discovered_links"
  ON discovered_links FOR UPDATE
  USING (
    (owner_id = auth.uid() OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = discovered_links.conversation_id
      AND (conversations.owner_id = auth.uid() OR conversations.owner_id IS NULL)
    )
  );

-- RPC: match discovered_links by embedding (for suggesting pages to add)
-- Excludes links already in the graph (already have a page)
CREATE OR REPLACE FUNCTION match_discovered_links(
  query_embedding vector(1536),
  match_conversation_id uuid,
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
  WHERE dl.conversation_id = match_conversation_id
    AND dl.source_id = ANY(match_source_ids)
    AND dl.embedding IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pages p
      WHERE p.source_id = dl.source_id
        AND p.conversation_id = dl.conversation_id
        AND p.url = dl.to_url
    )
  ORDER BY dl.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION match_discovered_links(vector(1536), uuid, uuid[], int) TO authenticated;
GRANT EXECUTE ON FUNCTION match_discovered_links(vector(1536), uuid, uuid[], int) TO anon;
GRANT EXECUTE ON FUNCTION match_discovered_links(vector(1536), uuid, uuid[], int) TO service_role;
