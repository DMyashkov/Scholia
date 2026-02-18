-- Migration 54: Drop from_url from page_edges (infer from from_page_id -> pages.url)

ALTER TABLE page_edges DROP COLUMN IF EXISTS from_url;
