-- Migration 7: Isolate graph data per conversation
-- Each conversation should have its own pages and edges, no sharing
-- File: supabase/migrations/007_isolate_conversation_graphs.sql

-- Add conversation_id to pages table (nullable first) - only if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'conversation_id'
  ) THEN
    ALTER TABLE pages
    ADD COLUMN conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add conversation_id to page_edges table (nullable first) - only if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'page_edges' AND column_name = 'conversation_id'
  ) THEN
    ALTER TABLE page_edges
    ADD COLUMN conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Update existing pages/edges to link to their conversation via conversation_sources
-- This migration assumes pages/edges should be linked to the first conversation that uses the source
UPDATE pages p
SET conversation_id = (
  SELECT cs.conversation_id 
  FROM conversation_sources cs 
  WHERE cs.source_id = p.source_id 
  LIMIT 1
)
WHERE conversation_id IS NULL;

UPDATE page_edges pe
SET conversation_id = (
  SELECT cs.conversation_id 
  FROM conversation_sources cs 
  WHERE pe.source_id = cs.source_id 
  LIMIT 1
)
WHERE conversation_id IS NULL;

-- Delete any pages/edges that couldn't be linked to a conversation (orphaned data)
DELETE FROM pages WHERE conversation_id IS NULL;
DELETE FROM page_edges WHERE conversation_id IS NULL;

-- Now make conversation_id NOT NULL after cleaning up (only if it's still nullable)
DO $$ 
BEGIN
  -- Check if pages.conversation_id is nullable and make it NOT NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' 
    AND column_name = 'conversation_id' 
    AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE pages ALTER COLUMN conversation_id SET NOT NULL;
  END IF;
  
  -- Check if page_edges.conversation_id is nullable and make it NOT NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'page_edges' 
    AND column_name = 'conversation_id' 
    AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE page_edges ALTER COLUMN conversation_id SET NOT NULL;
  END IF;
END $$;

-- Update unique constraints to include conversation_id
ALTER TABLE pages
DROP CONSTRAINT IF EXISTS pages_source_id_url_key;

ALTER TABLE pages
ADD CONSTRAINT pages_conversation_source_url_key UNIQUE (conversation_id, source_id, url);

-- Update page_edges unique constraint (already uses from_url/to_url from migration 005)
ALTER TABLE page_edges
DROP CONSTRAINT IF EXISTS unique_page_edge;

ALTER TABLE page_edges
ADD CONSTRAINT unique_page_edge UNIQUE (conversation_id, source_id, from_url, to_url);

-- Add indexes for performance (only if they don't exist)
CREATE INDEX IF NOT EXISTS idx_pages_conversation ON pages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_page_edges_conversation ON page_edges(conversation_id);

-- Update RLS policies to filter by conversation_id
DROP POLICY IF EXISTS "Users can view pages from their sources" ON pages;
CREATE POLICY "Users can view pages from their conversations"
  ON pages FOR SELECT
  USING (
    (owner_id = auth.uid() OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = pages.conversation_id
      AND (conversations.owner_id = auth.uid() OR conversations.owner_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users can view edges from their sources" ON page_edges;
CREATE POLICY "Users can view edges from their conversations"
  ON page_edges FOR SELECT
  USING (
    (owner_id = auth.uid() OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = page_edges.conversation_id
      AND (conversations.owner_id = auth.uid() OR conversations.owner_id IS NULL)
    )
  );
