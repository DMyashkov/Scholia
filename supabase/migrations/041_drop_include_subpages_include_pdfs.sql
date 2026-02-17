-- Drop include_subpages and include_pdfs from sources (no longer used)
ALTER TABLE sources DROP COLUMN IF EXISTS include_subpages;
ALTER TABLE sources DROP COLUMN IF EXISTS include_pdfs;
