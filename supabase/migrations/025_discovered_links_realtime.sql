-- Enable Realtime for discovered_links so the UI can show count updates during add-page encoding
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'discovered_links'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE discovered_links;
  END IF;
END
$$;
