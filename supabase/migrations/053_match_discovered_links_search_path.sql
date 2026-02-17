-- Migration 53: Fix match_discovered_links - add extensions to search_path
-- pgvector was moved to extensions schema (migration 030); the <=> operator
-- lives there, so search_path must include extensions for the RPC to work.

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
