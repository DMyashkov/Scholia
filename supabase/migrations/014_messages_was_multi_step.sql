-- Migration 14: Add was_multi_step to messages for 2-round RAG badge
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS was_multi_step BOOLEAN DEFAULT FALSE;
