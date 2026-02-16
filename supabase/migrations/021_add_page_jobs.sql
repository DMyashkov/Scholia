-- add_page_jobs: track add-page edge function phases for frontend status (indexing → encoding → completed)
CREATE TABLE add_page_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('indexing', 'encoding', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_add_page_jobs_source ON add_page_jobs(source_id);
CREATE INDEX idx_add_page_jobs_created ON add_page_jobs(created_at DESC);

ALTER TABLE add_page_jobs ENABLE ROW LEVEL SECURITY;

-- Users can view/add_page_jobs for their conversations
CREATE POLICY "Users can view add_page_jobs for their conversations"
  ON add_page_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = add_page_jobs.conversation_id
      AND (c.owner_id = auth.uid() OR c.owner_id IS NULL)
    )
  );

CREATE POLICY "Users can insert add_page_jobs for their conversations"
  ON add_page_jobs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = add_page_jobs.conversation_id
      AND (c.owner_id = auth.uid() OR c.owner_id IS NULL)
    )
  );

CREATE POLICY "Users can update add_page_jobs for their conversations"
  ON add_page_jobs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = add_page_jobs.conversation_id
      AND (c.owner_id = auth.uid() OR c.owner_id IS NULL)
    )
  );

-- Realtime for add_page_jobs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'add_page_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE add_page_jobs;
  END IF;
END
$$;
