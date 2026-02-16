-- Migration 29: Optimize RLS policies for performance
-- Replace auth.uid() with (select auth.uid()) so it's evaluated once per query
-- instead of per row. See: https://supabase.com/docs/guides/database/database-advisors?lint=0003_auth_rls_initplan

-- conversations
DROP POLICY IF EXISTS "Users can view their own conversations" ON conversations;
CREATE POLICY "Users can view their own conversations"
  ON conversations FOR SELECT
  USING (owner_id = (select auth.uid()) OR owner_id IS NULL);

DROP POLICY IF EXISTS "Users can create conversations" ON conversations;
CREATE POLICY "Users can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (owner_id = (select auth.uid()) OR owner_id IS NULL);

DROP POLICY IF EXISTS "Users can update their own conversations" ON conversations;
CREATE POLICY "Users can update their own conversations"
  ON conversations FOR UPDATE
  USING (owner_id = (select auth.uid()))
  WITH CHECK (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete their own conversations" ON conversations;
CREATE POLICY "Users can delete their own conversations"
  ON conversations FOR DELETE
  USING (owner_id = (select auth.uid()) OR owner_id IS NULL);

-- messages
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
CREATE POLICY "Users can view messages in their conversations"
  ON messages FOR SELECT
  USING (
    owner_id = (select auth.uid()) OR owner_id IS NULL OR
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND (conversations.owner_id = (select auth.uid()) OR conversations.owner_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can create messages in their conversations" ON messages;
CREATE POLICY "Users can create messages in their conversations"
  ON messages FOR INSERT
  WITH CHECK (
    (owner_id = (select auth.uid()) OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND (conversations.owner_id = (select auth.uid()) OR conversations.owner_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can update their own messages" ON messages;
CREATE POLICY "Users can update their own messages"
  ON messages FOR UPDATE
  USING (owner_id = (select auth.uid()))
  WITH CHECK (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete their own messages" ON messages;
CREATE POLICY "Users can delete their own messages"
  ON messages FOR DELETE
  USING (owner_id = (select auth.uid()));

-- sources
DROP POLICY IF EXISTS "Users can view their own sources" ON sources;
CREATE POLICY "Users can view their own sources"
  ON sources FOR SELECT
  USING (owner_id = (select auth.uid()) OR owner_id IS NULL);

DROP POLICY IF EXISTS "Users can create sources" ON sources;
CREATE POLICY "Users can create sources"
  ON sources FOR INSERT
  WITH CHECK (owner_id = (select auth.uid()) OR owner_id IS NULL);

DROP POLICY IF EXISTS "Users can update their own sources" ON sources;
CREATE POLICY "Users can update their own sources"
  ON sources FOR UPDATE
  USING (owner_id = (select auth.uid()))
  WITH CHECK (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete their own sources" ON sources;
CREATE POLICY "Users can delete their own sources"
  ON sources FOR DELETE
  USING (owner_id = (select auth.uid()));

-- conversation_sources
DROP POLICY IF EXISTS "Users can view conversation sources for their conversations" ON conversation_sources;
CREATE POLICY "Users can view conversation sources for their conversations"
  ON conversation_sources FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = conversation_sources.conversation_id
      AND (conversations.owner_id = (select auth.uid()) OR conversations.owner_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can add sources to their conversations" ON conversation_sources;
CREATE POLICY "Users can add sources to their conversations"
  ON conversation_sources FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = conversation_sources.conversation_id
      AND (conversations.owner_id = (select auth.uid()) OR conversations.owner_id IS NULL)
    ) AND
    EXISTS (
      SELECT 1 FROM sources
      WHERE sources.id = conversation_sources.source_id
      AND (sources.owner_id = (select auth.uid()) OR sources.owner_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can remove sources from their conversations" ON conversation_sources;
CREATE POLICY "Users can remove sources from their conversations"
  ON conversation_sources FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = conversation_sources.conversation_id
      AND (conversations.owner_id = (select auth.uid()) OR conversations.owner_id IS NULL)
    )
  );

-- crawl_jobs
DROP POLICY IF EXISTS "Users can view their own crawl jobs" ON crawl_jobs;
CREATE POLICY "Users can view their own crawl jobs"
  ON crawl_jobs FOR SELECT
  USING (owner_id = (select auth.uid()) OR owner_id IS NULL);

DROP POLICY IF EXISTS "Users can create crawl jobs" ON crawl_jobs;
CREATE POLICY "Users can create crawl jobs"
  ON crawl_jobs FOR INSERT
  WITH CHECK (owner_id = (select auth.uid()) OR owner_id IS NULL);

DROP POLICY IF EXISTS "Users can update their own crawl jobs" ON crawl_jobs;
CREATE POLICY "Users can update their own crawl jobs"
  ON crawl_jobs FOR UPDATE
  USING (owner_id = (select auth.uid()))
  WITH CHECK (owner_id = (select auth.uid()));

-- pages (policies from 007 and 028 - "view from sources" was replaced by "from conversations")
DROP POLICY IF EXISTS "Users can view pages from their sources" ON pages;
DROP POLICY IF EXISTS "Users can view pages from their conversations" ON pages;
CREATE POLICY "Users can view pages from their conversations"
  ON pages FOR SELECT
  USING (
    (owner_id = (select auth.uid()) OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = pages.conversation_id
      AND (conversations.owner_id = (select auth.uid()) OR conversations.owner_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can create pages" ON pages;
CREATE POLICY "Users can create pages"
  ON pages FOR INSERT
  WITH CHECK (owner_id = (select auth.uid()) OR owner_id IS NULL);

DROP POLICY IF EXISTS "Users can update their own pages" ON pages;
CREATE POLICY "Users can update their own pages"
  ON pages FOR UPDATE
  USING (owner_id = (select auth.uid()))
  WITH CHECK (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete pages from their conversations" ON pages;
CREATE POLICY "Users can delete pages from their conversations"
  ON pages FOR DELETE
  USING (
    (owner_id = (select auth.uid()) OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = pages.conversation_id
      AND (c.owner_id = (select auth.uid()) OR c.owner_id IS NULL)
    )
  );

-- page_edges
DROP POLICY IF EXISTS "Users can view edges from their sources" ON page_edges;
DROP POLICY IF EXISTS "Users can view edges from their conversations" ON page_edges;
CREATE POLICY "Users can view edges from their conversations"
  ON page_edges FOR SELECT
  USING (
    (owner_id = (select auth.uid()) OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = page_edges.conversation_id
      AND (conversations.owner_id = (select auth.uid()) OR conversations.owner_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can create edges" ON page_edges;
CREATE POLICY "Users can create edges"
  ON page_edges FOR INSERT
  WITH CHECK (owner_id = (select auth.uid()) OR owner_id IS NULL);

DROP POLICY IF EXISTS "Users can delete page_edges from their conversations" ON page_edges;
CREATE POLICY "Users can delete page_edges from their conversations"
  ON page_edges FOR DELETE
  USING (
    (owner_id = (select auth.uid()) OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = page_edges.conversation_id
      AND (c.owner_id = (select auth.uid()) OR c.owner_id IS NULL)
    )
  );

-- chunks
DROP POLICY IF EXISTS "Users can view chunks from their pages" ON chunks;
CREATE POLICY "Users can view chunks from their pages"
  ON chunks FOR SELECT
  USING (owner_id = (select auth.uid()) OR owner_id IS NULL);

DROP POLICY IF EXISTS "Users can create chunks" ON chunks;
CREATE POLICY "Users can create chunks"
  ON chunks FOR INSERT
  WITH CHECK (owner_id = (select auth.uid()) OR owner_id IS NULL);

DROP POLICY IF EXISTS "Users can delete chunks from their conversation pages" ON chunks;
CREATE POLICY "Users can delete chunks from their conversation pages"
  ON chunks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM pages p
      JOIN conversations c ON c.id = p.conversation_id
      WHERE p.id = chunks.page_id
      AND (c.owner_id = (select auth.uid()) OR c.owner_id IS NULL)
    )
  );

-- citations
DROP POLICY IF EXISTS "Users can view citations from their messages" ON citations;
CREATE POLICY "Users can view citations from their messages"
  ON citations FOR SELECT
  USING (owner_id = (select auth.uid()) OR owner_id IS NULL);

DROP POLICY IF EXISTS "Users can create citations" ON citations;
CREATE POLICY "Users can create citations"
  ON citations FOR INSERT
  WITH CHECK (owner_id = (select auth.uid()) OR owner_id IS NULL);

-- discovered_links
DROP POLICY IF EXISTS "Users can view discovered_links from their conversations" ON discovered_links;
CREATE POLICY "Users can view discovered_links from their conversations"
  ON discovered_links FOR SELECT
  USING (
    (owner_id = (select auth.uid()) OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = discovered_links.conversation_id
      AND (conversations.owner_id = (select auth.uid()) OR conversations.owner_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can insert discovered_links" ON discovered_links;
CREATE POLICY "Users can insert discovered_links"
  ON discovered_links FOR INSERT
  WITH CHECK (
    (owner_id = (select auth.uid()) OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = discovered_links.conversation_id
      AND (conversations.owner_id = (select auth.uid()) OR conversations.owner_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can update discovered_links" ON discovered_links;
CREATE POLICY "Users can update discovered_links"
  ON discovered_links FOR UPDATE
  USING (
    (owner_id = (select auth.uid()) OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = discovered_links.conversation_id
      AND (conversations.owner_id = (select auth.uid()) OR conversations.owner_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can delete discovered_links from their conversations" ON discovered_links;
CREATE POLICY "Users can delete discovered_links from their conversations"
  ON discovered_links FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = discovered_links.conversation_id
      AND (c.owner_id = (select auth.uid()) OR c.owner_id IS NULL)
    )
  );

-- add_page_jobs
DROP POLICY IF EXISTS "Users can view add_page_jobs for their conversations" ON add_page_jobs;
CREATE POLICY "Users can view add_page_jobs for their conversations"
  ON add_page_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = add_page_jobs.conversation_id
      AND (c.owner_id = (select auth.uid()) OR c.owner_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can insert add_page_jobs for their conversations" ON add_page_jobs;
CREATE POLICY "Users can insert add_page_jobs for their conversations"
  ON add_page_jobs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = add_page_jobs.conversation_id
      AND (c.owner_id = (select auth.uid()) OR c.owner_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can update add_page_jobs for their conversations" ON add_page_jobs;
CREATE POLICY "Users can update add_page_jobs for their conversations"
  ON add_page_jobs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = add_page_jobs.conversation_id
      AND (c.owner_id = (select auth.uid()) OR c.owner_id IS NULL)
    )
  );

-- user_settings
DROP POLICY IF EXISTS "Users can view own settings" ON user_settings;
CREATE POLICY "Users can view own settings"
  ON user_settings FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own settings" ON user_settings;
CREATE POLICY "Users can insert own settings"
  ON user_settings FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own settings" ON user_settings;
CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  USING ((select auth.uid()) = user_id);

-- rag_run_log
DROP POLICY IF EXISTS "Users can insert own rag_run_log" ON rag_run_log;
CREATE POLICY "Users can insert own rag_run_log"
  ON rag_run_log FOR INSERT
  WITH CHECK ((select auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Users can view own rag_run_log" ON rag_run_log;
CREATE POLICY "Users can view own rag_run_log"
  ON rag_run_log FOR SELECT
  USING ((select auth.uid()) = owner_id);
