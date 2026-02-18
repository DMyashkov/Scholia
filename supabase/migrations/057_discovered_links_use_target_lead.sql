-- Migration 57: Experimental setting for discovered links - store target page lead instead of source context
-- When true: crawl each discovered link's target page, store first 200 chars (lead) for RAG suggestions
-- When false (default): current behavior - store 200 chars of context around the link on the source page
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS discovered_links_use_target_lead BOOLEAN NOT NULL DEFAULT false;
