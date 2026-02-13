-- RPC: return one chunk per page with the shortest content (likely the lead/intro paragraph).
-- Use with match_chunks so biographical facts in the first paragraph are always in context.
CREATE OR REPLACE FUNCTION get_lead_chunks(match_page_ids uuid[])
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (c.page_id)
    c.id,
    c.page_id,
    c.content,
    p.source_id,
    p.title AS page_title,
    p.path AS page_path,
    p.url AS page_url,
    s.domain AS source_domain,
    0::float AS distance
  FROM chunks c
  JOIN pages p ON p.id = c.page_id
  JOIN sources s ON s.id = p.source_id
  WHERE c.page_id = ANY(match_page_ids)
  ORDER BY c.page_id, length(c.content);
$$;

GRANT EXECUTE ON FUNCTION get_lead_chunks(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_lead_chunks(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION get_lead_chunks(uuid[]) TO service_role;
