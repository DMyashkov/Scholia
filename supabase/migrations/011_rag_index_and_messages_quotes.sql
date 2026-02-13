-- Migration 11: RAG support — vector index on chunks, messages.quotes, match_chunks RPC

-- Enable pgvector (Supabase usually has it; safe to run if already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- HNSW index on chunks.embedding for cosine similarity (<=>)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- Store quotes on the message for the UI (snippet, pageId, pageTitle, pagePath, domain, sourceId)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS quotes JSONB DEFAULT NULL;

-- RPC: similarity search over chunks for given page_ids (conversation-scoped)
-- Returns chunks ordered by cosine distance, with page/source metadata for building context and citations
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1536),
  match_page_ids uuid[],
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  page_id uuid,
  content text,
  source_id uuid,
  page_title text,
  page_path text,
  page_url text,
  source_domain text,
  distance float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.page_id,
    c.content,
    p.source_id,
    p.title AS page_title,
    p.path AS page_path,
    p.url AS page_url,
    s.domain AS source_domain,
    (c.embedding <=> query_embedding) AS distance
  FROM chunks c
  JOIN pages p ON p.id = c.page_id
  JOIN sources s ON s.id = p.source_id
  WHERE c.embedding IS NOT NULL
    AND c.page_id = ANY(match_page_ids)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Allow RLS-bound roles to call the function (function runs as definer and filters by page_ids)
GRANT EXECUTE ON FUNCTION match_chunks(vector(1536), uuid[], int) TO authenticated;
GRANT EXECUTE ON FUNCTION match_chunks(vector(1536), uuid[], int) TO anon;
GRANT EXECUTE ON FUNCTION match_chunks(vector(1536), uuid[], int) TO service_role;
