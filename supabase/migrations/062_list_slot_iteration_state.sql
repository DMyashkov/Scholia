-- Migration 62: list slot iteration state and subquery strategy

BEGIN;

-- 1) Per-list-slot iteration state for a given root_message_id
CREATE TABLE IF NOT EXISTS slot_iteration_state (
  root_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  attempt_count INT NOT NULL DEFAULT 0,
  last_item_count INT NOT NULL DEFAULT 0,
  stagnation_count INT NOT NULL DEFAULT 0,
  last_strategy TEXT NOT NULL DEFAULT 'broad',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (root_message_id, slot_id)
);

CREATE INDEX IF NOT EXISTS idx_slot_iteration_state_root_message
  ON slot_iteration_state(root_message_id);

CREATE INDEX IF NOT EXISTS idx_slot_iteration_state_slot
  ON slot_iteration_state(slot_id);

ALTER TABLE slot_iteration_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own slot_iteration_state"
  ON slot_iteration_state FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM slots s
      WHERE s.id = slot_iteration_state.slot_id
        AND s.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can modify own slot_iteration_state"
  ON slot_iteration_state FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM slots s
      WHERE s.id = slot_iteration_state.slot_id
        AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM slots s
      WHERE s.id = slot_iteration_state.slot_id
        AND s.owner_id = auth.uid()
    )
  );

-- 2) Add strategy column on reasoning_subqueries
ALTER TABLE reasoning_subqueries
  ADD COLUMN IF NOT EXISTS strategy TEXT;

COMMIT;

