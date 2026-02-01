-- Enable Supabase Realtime (postgres_changes) for crawl_jobs, pages, and page_edges.
-- Without this, INSERTs on these tables do NOT trigger realtime events, so the UI
-- never invalidates/refetches and edges (and sometimes pages) stay empty until
-- the user switches away and back (manual refetch).
-- Add each table only if not already in the publication (idempotent).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'crawl_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE crawl_jobs;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'pages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE pages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'page_edges'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE page_edges;
  END IF;
END
$$;
