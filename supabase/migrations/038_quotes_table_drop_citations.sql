-- Migration 38: Replace messages.quotes JSONB and citations table with a quotes table
-- 1. Create quotes table
-- 2. Migrate data from messages.quotes JSONB
-- 3. Drop citations table
-- 4. Drop messages.quotes column
-- 5. RLS and triggers for quotes

-- 1. Create quotes table
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  snippet TEXT NOT NULL,
  page_title TEXT NOT NULL DEFAULT '',
  page_path TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT '',
  page_url TEXT,
  context_before TEXT,
  context_after TEXT,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quotes_message ON quotes(message_id);
CREATE INDEX idx_quotes_page ON quotes(page_id);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

-- 2. Migrate data from messages.quotes JSONB to quotes table
INSERT INTO quotes (message_id, page_id, source_id, snippet, page_title, page_path, domain, page_url, context_before, context_after, owner_id)
SELECT
  m.id AS message_id,
  (q->>'pageId')::UUID AS page_id,
  (q->>'sourceId')::UUID AS source_id,
  COALESCE(q->>'snippet', '') AS snippet,
  COALESCE(q->>'pageTitle', '') AS page_title,
  COALESCE(q->>'pagePath', '') AS page_path,
  COALESCE(q->>'domain', '') AS domain,
  NULLIF(q->>'pageUrl', '') AS page_url,
  NULLIF(q->>'contextBefore', '') AS context_before,
  NULLIF(q->>'contextAfter', '') AS context_after,
  m.owner_id
FROM messages m,
  jsonb_array_elements(COALESCE(m.quotes, '[]'::jsonb)) AS q
WHERE m.quotes IS NOT NULL
  AND jsonb_array_length(m.quotes) > 0
  AND (q->>'pageId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND (q->>'sourceId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (SELECT 1 FROM pages p WHERE p.id = (q->>'pageId')::UUID)
  AND EXISTS (SELECT 1 FROM sources s WHERE s.id = (q->>'sourceId')::UUID);

-- 3. Drop citations table (policies drop via CASCADE)
DROP TABLE IF EXISTS citations;

-- 4. Drop messages.quotes column
ALTER TABLE messages DROP COLUMN IF EXISTS quotes;

-- 5. RLS policies for quotes
CREATE POLICY "Users can view quotes from their messages"
  ON quotes FOR SELECT
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY "Users can create quotes"
  ON quotes FOR INSERT
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete their own quotes"
  ON quotes FOR DELETE
  USING (owner_id = (SELECT auth.uid()));

-- 6. Trigger for set_owner_id (quotes)
CREATE TRIGGER set_quotes_owner
  BEFORE INSERT ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();
