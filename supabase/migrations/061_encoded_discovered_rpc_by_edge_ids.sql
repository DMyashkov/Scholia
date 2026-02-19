-- Migration 61: RPCs for encoded_discovered by edge_ids (request body) to avoid long URLs

-- Count rows in encoded_discovered where page_edge_id = ANY(edge_ids)
CREATE OR REPLACE FUNCTION count_encoded_discovered_by_edge_ids(edge_ids uuid[])
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF edge_ids IS NULL OR array_length(edge_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;
  RETURN (
    SELECT count(*)::bigint
    FROM encoded_discovered ed
    WHERE ed.page_edge_id = ANY(edge_ids)
  );
END;
$$;

-- Count rows in encoded_discovered where page_edge_id = ANY(edge_ids) AND embedding IS NOT NULL
CREATE OR REPLACE FUNCTION count_encoded_discovered_with_embedding_by_edge_ids(edge_ids uuid[])
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF edge_ids IS NULL OR array_length(edge_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;
  RETURN (
    SELECT count(*)::bigint
    FROM encoded_discovered ed
    WHERE ed.page_edge_id = ANY(edge_ids)
      AND ed.embedding IS NOT NULL
  );
END;
$$;

-- Return page_edge_ids from encoded_discovered where page_edge_id = ANY(edge_ids)
CREATE OR REPLACE FUNCTION get_encoded_discovered_page_edge_ids(edge_ids uuid[])
RETURNS TABLE(page_edge_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF edge_ids IS NULL OR array_length(edge_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT ed.page_edge_id
  FROM encoded_discovered ed
  WHERE ed.page_edge_id = ANY(edge_ids);
END;
$$;

-- Return page_edge_ids from encoded_discovered where page_edge_id = ANY(edge_ids) AND embedding IS NOT NULL
CREATE OR REPLACE FUNCTION get_encoded_discovered_with_embedding_page_edge_ids(edge_ids uuid[])
RETURNS TABLE(page_edge_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF edge_ids IS NULL OR array_length(edge_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT ed.page_edge_id
  FROM encoded_discovered ed
  WHERE ed.page_edge_id = ANY(edge_ids)
    AND ed.embedding IS NOT NULL;
END;
$$;
