-- Migration 17: Store suggested pages (from dynamic mode RAG) on messages
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS suggested_pages JSONB DEFAULT NULL;
