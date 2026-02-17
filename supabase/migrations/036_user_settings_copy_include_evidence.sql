-- Migration 36: Add copy_include_evidence to user_settings
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS copy_include_evidence BOOLEAN NOT NULL DEFAULT true;
