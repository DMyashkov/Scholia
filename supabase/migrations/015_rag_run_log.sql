-- Debug table to trace when 2-round RAG is used (query in Supabase dashboard)
CREATE TABLE IF NOT EXISTS rag_run_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  needs_second_round BOOLEAN NOT NULL,
  did_second_round BOOLEAN NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_run_log_conversation ON rag_run_log(conversation_id);
CREATE INDEX IF NOT EXISTS idx_rag_run_log_created ON rag_run_log(created_at DESC);

ALTER TABLE rag_run_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own rag_run_log"
  ON rag_run_log FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can view own rag_run_log"
  ON rag_run_log FOR SELECT
  USING (auth.uid() = owner_id);

GRANT INSERT, SELECT ON rag_run_log TO authenticated;
