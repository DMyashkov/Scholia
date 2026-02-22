-- Store items_per_key for mapping slots; mapping target is computed as dep list length * items_per_key
-- so we don't persist target_item_count for mapping (list still uses target_item_count).

BEGIN;

ALTER TABLE slots
  ADD COLUMN IF NOT EXISTS items_per_key INT;

COMMIT;
