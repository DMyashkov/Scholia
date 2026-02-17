-- Migration 46: Drop source_id from quotes (infer from page_id via pages)

ALTER TABLE quotes DROP COLUMN IF EXISTS source_id;
