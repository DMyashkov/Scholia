-- Refactor slot_iteration_state: broad/targeted only, add completed and last_queries for extract context.
-- Broad = first attempt only (discovery). Targeted = subsequent (semantic slicing). No seeded.

BEGIN;

-- 1) Add new columns
ALTER TABLE slot_iteration_state
  ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_queries TEXT[] DEFAULT '{}';

-- 2) Drop stagnation_count (no longer used)
ALTER TABLE slot_iteration_state
  DROP COLUMN IF EXISTS stagnation_count;

-- 3) Migrate any existing 'seeded' or NULL to 'targeted' before adding constraint
UPDATE slot_iteration_state
  SET last_strategy = 'targeted'
  WHERE last_strategy = 'seeded' OR last_strategy IS NULL;

-- 4) Constrain last_strategy to 'broad' | 'targeted' only
ALTER TABLE slot_iteration_state
  DROP CONSTRAINT IF EXISTS slot_iteration_state_last_strategy_check;

ALTER TABLE slot_iteration_state
  ADD CONSTRAINT slot_iteration_state_last_strategy_check
  CHECK (last_strategy IN ('broad', 'targeted'));

ALTER TABLE slot_iteration_state
  ALTER COLUMN last_strategy SET DEFAULT 'broad';

COMMIT;
