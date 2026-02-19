-- Migration 61: change claim_evidence to reference chunks instead of quotes
-- WARNING: this drops quote_id and existing data in claim_evidence. Run only after you are
-- comfortable migrating or discarding old claim_evidence rows.

BEGIN;

-- 1) Drop existing primary key and quote index
ALTER TABLE claim_evidence DROP CONSTRAINT IF EXISTS claim_evidence_pkey;
DROP INDEX IF EXISTS idx_claim_evidence_quote;

-- 2) Drop quote_id column
ALTER TABLE claim_evidence DROP COLUMN IF EXISTS quote_id;

-- 3) Add chunk_id column and new primary key / index
ALTER TABLE claim_evidence
  ADD COLUMN IF NOT EXISTS chunk_id UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE;

ALTER TABLE claim_evidence
  ADD CONSTRAINT claim_evidence_pkey PRIMARY KEY (slot_item_id, chunk_id);

CREATE INDEX IF NOT EXISTS idx_claim_evidence_chunk ON claim_evidence(chunk_id);

COMMIT;

