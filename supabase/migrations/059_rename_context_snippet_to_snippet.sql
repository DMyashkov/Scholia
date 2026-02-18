-- Migration 59: Rename context_snippet to snippet in encoded_discovered + match_discovered_links

-- 1. Rename column in encoded_discovered
ALTER TABLE encoded_discovered RENAME COLUMN context_snippet TO snippet;

-- 2. Drop existing function (return type change requires drop)
DROP FUNCTION IF EXISTS match_discovered_links(vector,uuid[],integer);

-- 3. Recreate match_discovered_links with snippet in return type
CREATE FUNCTION match_discovered_links(
  query_embedding vector(1536),
  match_source_ids uuid[],
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  to_url text,
  anchor_text text,
  snippet text,
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
    ed.snippet,
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
