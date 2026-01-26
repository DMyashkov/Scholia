-- Migration 3: Row Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE citations ENABLE ROW LEVEL SECURITY;

-- Conversations policies
CREATE POLICY "Users can view their own conversations"
  ON conversations FOR SELECT
  USING (owner_id = auth.uid() OR owner_id IS NULL);

CREATE POLICY "Users can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (owner_id = auth.uid() OR owner_id IS NULL);

CREATE POLICY "Users can update their own conversations"
  ON conversations FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can delete their own conversations"
  ON conversations FOR DELETE
  USING (owner_id = auth.uid() OR owner_id IS NULL);

-- Messages policies
CREATE POLICY "Users can view messages in their conversations"
  ON messages FOR SELECT
  USING (
    owner_id = auth.uid() OR owner_id IS NULL OR
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND (conversations.owner_id = auth.uid() OR conversations.owner_id IS NULL)
    )
  );

CREATE POLICY "Users can create messages in their conversations"
  ON messages FOR INSERT
  WITH CHECK (
    (owner_id = auth.uid() OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND (conversations.owner_id = auth.uid() OR conversations.owner_id IS NULL)
    )
  );

CREATE POLICY "Users can update their own messages"
  ON messages FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can delete their own messages"
  ON messages FOR DELETE
  USING (owner_id = auth.uid());

-- Sources policies
CREATE POLICY "Users can view their own sources"
  ON sources FOR SELECT
  USING (owner_id = auth.uid() OR owner_id IS NULL);

CREATE POLICY "Users can create sources"
  ON sources FOR INSERT
  WITH CHECK (owner_id = auth.uid() OR owner_id IS NULL);

CREATE POLICY "Users can update their own sources"
  ON sources FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can delete their own sources"
  ON sources FOR DELETE
  USING (owner_id = auth.uid());

-- Conversation sources policies
CREATE POLICY "Users can view conversation sources for their conversations"
  ON conversation_sources FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = conversation_sources.conversation_id
      AND (conversations.owner_id = auth.uid() OR conversations.owner_id IS NULL)
    )
  );

CREATE POLICY "Users can add sources to their conversations"
  ON conversation_sources FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = conversation_sources.conversation_id
      AND (conversations.owner_id = auth.uid() OR conversations.owner_id IS NULL)
    ) AND
    EXISTS (
      SELECT 1 FROM sources
      WHERE sources.id = conversation_sources.source_id
      AND (sources.owner_id = auth.uid() OR sources.owner_id IS NULL)
    )
  );

CREATE POLICY "Users can remove sources from their conversations"
  ON conversation_sources FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = conversation_sources.conversation_id
      AND (conversations.owner_id = auth.uid() OR conversations.owner_id IS NULL)
    )
  );

-- Crawl jobs policies
CREATE POLICY "Users can view their own crawl jobs"
  ON crawl_jobs FOR SELECT
  USING (owner_id = auth.uid() OR owner_id IS NULL);

CREATE POLICY "Users can create crawl jobs"
  ON crawl_jobs FOR INSERT
  WITH CHECK (owner_id = auth.uid() OR owner_id IS NULL);

CREATE POLICY "Users can update their own crawl jobs"
  ON crawl_jobs FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Pages policies
CREATE POLICY "Users can view pages from their sources"
  ON pages FOR SELECT
  USING (owner_id = auth.uid() OR owner_id IS NULL);

CREATE POLICY "Users can create pages"
  ON pages FOR INSERT
  WITH CHECK (owner_id = auth.uid() OR owner_id IS NULL);

CREATE POLICY "Users can update their own pages"
  ON pages FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Page edges policies
CREATE POLICY "Users can view edges from their sources"
  ON page_edges FOR SELECT
  USING (owner_id = auth.uid() OR owner_id IS NULL);

CREATE POLICY "Users can create edges"
  ON page_edges FOR INSERT
  WITH CHECK (owner_id = auth.uid() OR owner_id IS NULL);

-- Chunks policies
CREATE POLICY "Users can view chunks from their pages"
  ON chunks FOR SELECT
  USING (owner_id = auth.uid() OR owner_id IS NULL);

CREATE POLICY "Users can create chunks"
  ON chunks FOR INSERT
  WITH CHECK (owner_id = auth.uid() OR owner_id IS NULL);

-- Citations policies
CREATE POLICY "Users can view citations from their messages"
  ON citations FOR SELECT
  USING (owner_id = auth.uid() OR owner_id IS NULL);

CREATE POLICY "Users can create citations"
  ON citations FOR INSERT
  WITH CHECK (owner_id = auth.uid() OR owner_id IS NULL);


