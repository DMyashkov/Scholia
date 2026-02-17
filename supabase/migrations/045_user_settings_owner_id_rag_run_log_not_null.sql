-- Migration 45: user_settings user_id -> owner_id; rag_run_log owner_id NOT NULL

-- =============================================================================
-- 1. user_settings: rename user_id to owner_id
-- =============================================================================

ALTER TABLE user_settings RENAME COLUMN user_id TO owner_id;

-- RLS policies reference user_id; drop and recreate with owner_id
DROP POLICY IF EXISTS "Users can view own settings" ON user_settings;
DROP POLICY IF EXISTS "Users can insert own settings" ON user_settings;
DROP POLICY IF EXISTS "Users can update own settings" ON user_settings;

CREATE POLICY "Users can view own settings"
  ON user_settings FOR SELECT
  USING ((SELECT auth.uid()) = owner_id);

CREATE POLICY "Users can insert own settings"
  ON user_settings FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = owner_id);

CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  USING ((SELECT auth.uid()) = owner_id);

-- =============================================================================
-- 2. rag_run_log: owner_id NOT NULL (was nullable due to ON DELETE SET NULL)
-- =============================================================================

-- Drop FK, recreate with CASCADE, make NOT NULL
ALTER TABLE rag_run_log DROP CONSTRAINT IF EXISTS rag_run_log_owner_id_fkey;

-- Delete any rows with null owner_id (shouldn't exist for valid inserts)
DELETE FROM rag_run_log WHERE owner_id IS NULL;

ALTER TABLE rag_run_log
  ALTER COLUMN owner_id SET NOT NULL,
  ADD CONSTRAINT rag_run_log_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
