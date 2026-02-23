-- Migration 71: Drop unused 'required' column from slots
ALTER TABLE slots
  DROP COLUMN IF EXISTS required;

