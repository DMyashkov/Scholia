-- Add querying state and target cap to slots; finished_querying set by stagnation or broadQueryCompletedSlotFully.
-- Completeness for UI: target_item_count = 0 ? (finished_querying ? 1 : 0) : current_item_count / target_item_count.

BEGIN;

ALTER TABLE slots
  ADD COLUMN IF NOT EXISTS target_item_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_item_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finished_querying BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_queries TEXT[] DEFAULT '{}';

CREATE POLICY "Users can update own slots"
  ON slots FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

COMMIT;
