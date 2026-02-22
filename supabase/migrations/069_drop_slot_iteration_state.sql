-- Drop unused slot_iteration_state table (no application code references it).
-- State is tracked via slots (attempt_count, finished_querying, etc.) and reasoning_steps/reasoning_subqueries.

DROP TABLE IF EXISTS slot_iteration_state;
