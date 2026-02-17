-- Migration 51: Drop favicon from sources (unused; UI shows first letter fallback)
ALTER TABLE sources DROP COLUMN IF EXISTS favicon;
