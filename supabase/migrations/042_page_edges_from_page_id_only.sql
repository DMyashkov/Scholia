-- Migration 42: page_edges - require from_page_id, drop source_id and conversation_id
-- Derive source/conversation via from_page_id -> pages -> sources

-- 1. Delete orphan edges (no from_page_id)
DELETE FROM page_edges WHERE from_page_id IS NULL;

-- 2. Make from_page_id NOT NULL
ALTER TABLE page_edges ALTER COLUMN from_page_id SET NOT NULL;

-- 3. Add FK so edges cascade when page is deleted
ALTER TABLE page_edges
  ADD CONSTRAINT page_edges_from_page_id_fkey
  FOREIGN KEY (from_page_id) REFERENCES pages(id) ON DELETE CASCADE;

-- 4. Drop RLS policies that depend on conversation_id (before dropping column)
DROP POLICY IF EXISTS "Users can view edges from their conversations" ON page_edges;
DROP POLICY IF EXISTS "Users can view edges from their sources" ON page_edges;
DROP POLICY IF EXISTS "Users can delete page_edges from their conversations" ON page_edges;

-- 5. Drop old unique constraint and indexes that use source_id/conversation_id
ALTER TABLE page_edges DROP CONSTRAINT IF EXISTS unique_page_edge;
DROP INDEX IF EXISTS idx_page_edges_conversation;
DROP INDEX IF EXISTS idx_page_edges_source;

-- 6. Drop source_id and conversation_id
ALTER TABLE page_edges DROP COLUMN IF EXISTS source_id;
ALTER TABLE page_edges DROP COLUMN IF EXISTS conversation_id;

-- 7. Add new unique constraint (from_page_id, to_url)
ALTER TABLE page_edges
  ADD CONSTRAINT page_edges_from_page_to_url_key UNIQUE (from_page_id, to_url);

-- 8. Ensure index on from_page_id exists (for joins)
CREATE INDEX IF NOT EXISTS idx_page_edges_from_page ON page_edges(from_page_id);

-- 9. Recreate RLS policies: derive conversation via from_page_id -> pages -> sources -> conversations
CREATE POLICY "Users can view edges from their conversations"
  ON page_edges FOR SELECT
  USING (
    owner_id = (SELECT auth.uid()) AND
    EXISTS (
      SELECT 1 FROM pages p
      JOIN sources s ON s.id = p.source_id
      JOIN conversations c ON c.id = s.conversation_id
      WHERE p.id = page_edges.from_page_id
      AND c.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete page_edges from their conversations"
  ON page_edges FOR DELETE
  USING (
    owner_id = (SELECT auth.uid()) AND
    EXISTS (
      SELECT 1 FROM pages p
      JOIN sources s ON s.id = p.source_id
      JOIN conversations c ON c.id = s.conversation_id
      WHERE p.id = page_edges.from_page_id
      AND c.owner_id = (SELECT auth.uid())
    )
  );
