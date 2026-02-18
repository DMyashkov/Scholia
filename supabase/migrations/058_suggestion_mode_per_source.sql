-- Migration 58: Per-source suggestion mode (Surface vs Dive) - replaces user_settings.discovered_links_use_target_lead
-- Surface: use text around link on source page (faster)
-- Dive: fetch each linked page, use first 200 chars (slower, may improve suggestions)

-- 1. Add suggestion_mode to sources
ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS suggestion_mode TEXT NOT NULL DEFAULT 'surface'
  CHECK (suggestion_mode IN ('surface', 'dive'));

-- 2. Set existing dynamic sources to surface (safe default)
UPDATE sources SET suggestion_mode = 'surface' WHERE crawl_depth = 'dynamic';

-- 3. Remove from user_settings
ALTER TABLE user_settings DROP COLUMN IF EXISTS discovered_links_use_target_lead;
