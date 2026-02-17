-- Migration 34: Require authentication - remove guest mode
-- 1. Delete all guest (owner_id IS NULL) data
-- 2. Make owner_id NOT NULL on all tables
-- 3. Update RLS policies to require auth (remove "OR owner_id IS NULL")
-- 4. Update set_owner_id trigger to reject unauthenticated inserts

-- =============================================================================
-- 1. Delete all guest data (order matters for FK constraints)
-- =============================================================================

-- Conversations cascade to: messages, conversation_sources, pages, add_page_jobs, discovered_links
-- Pages cascade to: page_edges, chunks
DELETE FROM conversations WHERE owner_id IS NULL;

-- Sources cascade to: crawl_jobs, pages (but pages for guest convs already deleted)
-- Sources may still have crawl_jobs - delete sources last
DELETE FROM sources WHERE owner_id IS NULL;

-- =============================================================================
-- 2. Make owner_id NOT NULL
-- =============================================================================

ALTER TABLE conversations ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE messages ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE sources ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE crawl_jobs ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE pages ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE page_edges ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE chunks ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE citations ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE discovered_links ALTER COLUMN owner_id SET NOT NULL;

-- =============================================================================
-- 3. Update set_owner_id - require auth (reject anon)
-- =============================================================================

CREATE OR REPLACE FUNCTION set_owner_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required';
    END IF;
    NEW.owner_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

-- Add trigger for discovered_links (has owner_id but no trigger in 002)
DROP TRIGGER IF EXISTS set_discovered_links_owner ON discovered_links;
CREATE TRIGGER set_discovered_links_owner
  BEFORE INSERT ON discovered_links
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();

-- =============================================================================
-- 4. Update RLS - remove "OR owner_id IS NULL" (require auth)
-- =============================================================================

-- conversations
DROP POLICY IF EXISTS "Users can view their own conversations" ON conversations;
CREATE POLICY "Users can view their own conversations"
  ON conversations FOR SELECT
  USING (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can create conversations" ON conversations;
CREATE POLICY "Users can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete their own conversations" ON conversations;
CREATE POLICY "Users can delete their own conversations"
  ON conversations FOR DELETE
  USING (owner_id = (select auth.uid()));

-- messages
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
CREATE POLICY "Users can view messages in their conversations"
  ON messages FOR SELECT
  USING (
    owner_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.owner_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can create messages in their conversations" ON messages;
CREATE POLICY "Users can create messages in their conversations"
  ON messages FOR INSERT
  WITH CHECK (
    owner_id = (select auth.uid()) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.owner_id = (select auth.uid())
    )
  );

-- sources
DROP POLICY IF EXISTS "Users can view their own sources" ON sources;
CREATE POLICY "Users can view their own sources"
  ON sources FOR SELECT
  USING (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can create sources" ON sources;
CREATE POLICY "Users can create sources"
  ON sources FOR INSERT
  WITH CHECK (owner_id = (select auth.uid()));

-- conversation_sources
DROP POLICY IF EXISTS "Users can view conversation sources for their conversations" ON conversation_sources;
CREATE POLICY "Users can view conversation sources for their conversations"
  ON conversation_sources FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = conversation_sources.conversation_id
      AND conversations.owner_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can add sources to their conversations" ON conversation_sources;
CREATE POLICY "Users can add sources to their conversations"
  ON conversation_sources FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = conversation_sources.conversation_id
      AND conversations.owner_id = (select auth.uid())
    ) AND
    EXISTS (
      SELECT 1 FROM sources
      WHERE sources.id = conversation_sources.source_id
      AND sources.owner_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can remove sources from their conversations" ON conversation_sources;
CREATE POLICY "Users can remove sources from their conversations"
  ON conversation_sources FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = conversation_sources.conversation_id
      AND conversations.owner_id = (select auth.uid())
    )
  );

-- crawl_jobs
DROP POLICY IF EXISTS "Users can view their own crawl jobs" ON crawl_jobs;
CREATE POLICY "Users can view their own crawl jobs"
  ON crawl_jobs FOR SELECT
  USING (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can create crawl jobs" ON crawl_jobs;
CREATE POLICY "Users can create crawl jobs"
  ON crawl_jobs FOR INSERT
  WITH CHECK (owner_id = (select auth.uid()));

-- pages
DROP POLICY IF EXISTS "Users can view pages from their conversations" ON pages;
CREATE POLICY "Users can view pages from their conversations"
  ON pages FOR SELECT
  USING (
    owner_id = (select auth.uid()) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = pages.conversation_id
      AND conversations.owner_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can create pages" ON pages;
CREATE POLICY "Users can create pages"
  ON pages FOR INSERT
  WITH CHECK (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete pages from their conversations" ON pages;
CREATE POLICY "Users can delete pages from their conversations"
  ON pages FOR DELETE
  USING (
    owner_id = (select auth.uid()) AND
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = pages.conversation_id
      AND c.owner_id = (select auth.uid())
    )
  );

-- page_edges
DROP POLICY IF EXISTS "Users can view edges from their conversations" ON page_edges;
DROP POLICY IF EXISTS "Users can view edges from their sources" ON page_edges;
CREATE POLICY "Users can view edges from their conversations"
  ON page_edges FOR SELECT
  USING (
    owner_id = (select auth.uid()) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = page_edges.conversation_id
      AND conversations.owner_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can create edges" ON page_edges;
CREATE POLICY "Users can create edges"
  ON page_edges FOR INSERT
  WITH CHECK (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete page_edges from their conversations" ON page_edges;
CREATE POLICY "Users can delete page_edges from their conversations"
  ON page_edges FOR DELETE
  USING (
    owner_id = (select auth.uid()) AND
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = page_edges.conversation_id
      AND c.owner_id = (select auth.uid())
    )
  );

-- chunks
DROP POLICY IF EXISTS "Users can view chunks from their pages" ON chunks;
CREATE POLICY "Users can view chunks from their pages"
  ON chunks FOR SELECT
  USING (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can create chunks" ON chunks;
CREATE POLICY "Users can create chunks"
  ON chunks FOR INSERT
  WITH CHECK (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete chunks from their conversation pages" ON chunks;
CREATE POLICY "Users can delete chunks from their conversation pages"
  ON chunks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM pages p
      JOIN conversations c ON c.id = p.conversation_id
      WHERE p.id = chunks.page_id
      AND c.owner_id = (select auth.uid())
    )
  );

-- citations
DROP POLICY IF EXISTS "Users can view citations from their messages" ON citations;
CREATE POLICY "Users can view citations from their messages"
  ON citations FOR SELECT
  USING (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can create citations" ON citations;
CREATE POLICY "Users can create citations"
  ON citations FOR INSERT
  WITH CHECK (owner_id = (select auth.uid()));

-- discovered_links
DROP POLICY IF EXISTS "Users can view discovered_links from their conversations" ON discovered_links;
CREATE POLICY "Users can view discovered_links from their conversations"
  ON discovered_links FOR SELECT
  USING (
    owner_id = (select auth.uid()) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = discovered_links.conversation_id
      AND conversations.owner_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert discovered_links" ON discovered_links;
CREATE POLICY "Users can insert discovered_links"
  ON discovered_links FOR INSERT
  WITH CHECK (
    owner_id = (select auth.uid()) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = discovered_links.conversation_id
      AND conversations.owner_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update discovered_links" ON discovered_links;
CREATE POLICY "Users can update discovered_links"
  ON discovered_links FOR UPDATE
  USING (
    owner_id = (select auth.uid()) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = discovered_links.conversation_id
      AND conversations.owner_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete discovered_links from their conversations" ON discovered_links;
CREATE POLICY "Users can delete discovered_links from their conversations"
  ON discovered_links FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = discovered_links.conversation_id
      AND c.owner_id = (select auth.uid())
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
      AND c.owner_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert add_page_jobs for their conversations" ON add_page_jobs;
CREATE POLICY "Users can insert add_page_jobs for their conversations"
  ON add_page_jobs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = add_page_jobs.conversation_id
      AND c.owner_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update add_page_jobs for their conversations" ON add_page_jobs;
CREATE POLICY "Users can update add_page_jobs for their conversations"
  ON add_page_jobs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = add_page_jobs.conversation_id
      AND c.owner_id = (select auth.uid())
    )
  );

-- Revoke anon from match_discovered_links (RPC - only authenticated and service_role)
REVOKE EXECUTE ON FUNCTION match_discovered_links(vector(1536), uuid, uuid[], int) FROM anon;
