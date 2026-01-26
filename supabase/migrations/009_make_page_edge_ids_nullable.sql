-- Migration 9: Make from_page_id and to_page_id nullable in page_edges
-- Since we're using from_url and to_url now, the page_id columns can be nullable

-- Drop the NOT NULL constraint on from_page_id and to_page_id
ALTER TABLE page_edges
ALTER COLUMN from_page_id DROP NOT NULL;

ALTER TABLE page_edges
ALTER COLUMN to_page_id DROP NOT NULL;

-- Drop the old unique constraint that used page_ids
ALTER TABLE page_edges
DROP CONSTRAINT IF EXISTS page_edges_source_id_from_page_id_to_page_id_key;

-- The unique constraint using URLs is already in migration 007 (unique_page_edge)
-- which uses (conversation_id, source_id, from_url, to_url)

-- Drop the foreign key constraints since we're not using page_ids anymore
ALTER TABLE page_edges
DROP CONSTRAINT IF EXISTS page_edges_from_page_id_fkey;

ALTER TABLE page_edges
DROP CONSTRAINT IF EXISTS page_edges_to_page_id_fkey;

-- Drop the check constraint that compared page_ids
ALTER TABLE page_edges
DROP CONSTRAINT IF EXISTS page_edges_check;
