-- Migration 49: Drop duplicate index on page_edges (idx_page_edges_from and idx_page_edges_from_page are identical)
DROP INDEX IF EXISTS idx_page_edges_from;
