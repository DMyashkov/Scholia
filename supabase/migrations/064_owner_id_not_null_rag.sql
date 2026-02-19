-- Migration 64: make RAG owner_id columns NOT NULL and add owner_id to slot_iteration_state

BEGIN;

-- 1) Add owner_id to slot_iteration_state and backfill from slots
ALTER TABLE slot_iteration_state
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE slot_iteration_state sis
SET owner_id = s.owner_id
FROM slots s
WHERE s.id = sis.slot_id
  AND sis.owner_id IS NULL;

ALTER TABLE slot_iteration_state
  ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_slot_iteration_state_owner ON slot_iteration_state(owner_id);

-- 2) Backfill and enforce NOT NULL on RAG tables

-- reasoning_steps.owner_id
UPDATE reasoning_steps rs
SET owner_id = m.owner_id
FROM messages m
WHERE m.id = rs.root_message_id
  AND rs.owner_id IS NULL;

ALTER TABLE reasoning_steps
  ALTER COLUMN owner_id SET NOT NULL;

-- slots.owner_id
UPDATE slots s
SET owner_id = m.owner_id
FROM messages m
WHERE m.id = s.root_message_id
  AND s.owner_id IS NULL;

ALTER TABLE slots
  ALTER COLUMN owner_id SET NOT NULL;

-- slot_items.owner_id
UPDATE slot_items si
SET owner_id = s.owner_id
FROM slots s
WHERE s.id = si.slot_id
  AND si.owner_id IS NULL;

ALTER TABLE slot_items
  ALTER COLUMN owner_id SET NOT NULL;

-- reasoning_subqueries.owner_id
UPDATE reasoning_subqueries rsq
SET owner_id = rs.owner_id
FROM reasoning_steps rs
WHERE rs.id = rsq.reasoning_step_id
  AND rsq.owner_id IS NULL;

ALTER TABLE reasoning_subqueries
  ALTER COLUMN owner_id SET NOT NULL;

-- claim_evidence.owner_id
UPDATE claim_evidence ce
SET owner_id = si.owner_id
FROM slot_items si
WHERE si.id = ce.slot_item_id
  AND ce.owner_id IS NULL;

ALTER TABLE claim_evidence
  ALTER COLUMN owner_id SET NOT NULL;

COMMIT;

