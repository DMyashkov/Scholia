-- Migration 60: Unfold v2 — reasoning_steps, slots, slot_items, claim_evidence, reasoning_subqueries; alter quotes; messages.thought_process

-- =============================================================================
-- 1. reasoning_steps
-- =============================================================================
CREATE TABLE reasoning_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  root_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  iteration_number INT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('retrieve', 'expand_corpus', 'clarify', 'answer')),
  why TEXT,
  completeness_score REAL,
  expansion_recommended BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reasoning_steps_root_message ON reasoning_steps(root_message_id);
CREATE INDEX idx_reasoning_steps_owner ON reasoning_steps(owner_id);

ALTER TABLE reasoning_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reasoning_steps"
  ON reasoning_steps FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Users can insert own reasoning_steps"
  ON reasoning_steps FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER set_reasoning_steps_owner
  BEFORE INSERT ON reasoning_steps
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();

-- =============================================================================
-- 2. slots
-- =============================================================================
CREATE TABLE slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  root_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('scalar', 'list', 'mapping')),
  description TEXT,
  required BOOLEAN NOT NULL DEFAULT true,
  depends_on_slot_id UUID REFERENCES slots(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(root_message_id, name)
);

CREATE INDEX idx_slots_root_message ON slots(root_message_id);
CREATE INDEX idx_slots_owner ON slots(owner_id);

ALTER TABLE slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own slots"
  ON slots FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Users can insert own slots"
  ON slots FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER set_slots_owner
  BEFORE INSERT ON slots
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();

-- =============================================================================
-- 3. slot_items
-- =============================================================================
CREATE TABLE slot_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  key TEXT,
  value_json JSONB NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  complete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_slot_items_slot ON slot_items(slot_id);
CREATE INDEX idx_slot_items_owner ON slot_items(owner_id);

ALTER TABLE slot_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own slot_items"
  ON slot_items FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Users can insert own slot_items"
  ON slot_items FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER set_slot_items_owner
  BEFORE INSERT ON slot_items
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();

-- =============================================================================
-- 4. claim_evidence (after quotes alteration so quotes table exists with new columns)
-- =============================================================================
-- Created after quotes alteration below

-- =============================================================================
-- 5. reasoning_subqueries
-- =============================================================================
CREATE TABLE reasoning_subqueries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reasoning_step_id UUID NOT NULL REFERENCES reasoning_steps(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reasoning_subqueries_step ON reasoning_subqueries(reasoning_step_id);
CREATE INDEX idx_reasoning_subqueries_slot ON reasoning_subqueries(slot_id);
CREATE INDEX idx_reasoning_subqueries_owner ON reasoning_subqueries(owner_id);

ALTER TABLE reasoning_subqueries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reasoning_subqueries"
  ON reasoning_subqueries FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Users can insert own reasoning_subqueries"
  ON reasoning_subqueries FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER set_reasoning_subqueries_owner
  BEFORE INSERT ON reasoning_subqueries
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();

-- =============================================================================
-- 6. Alter quotes: add columns, message_id nullable
-- =============================================================================
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS retrieved_in_reasoning_step_id UUID REFERENCES reasoning_steps(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS citation_order INT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS chunk_id UUID REFERENCES chunks(id) ON DELETE SET NULL;

ALTER TABLE quotes ALTER COLUMN message_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_retrieved_in_step ON quotes(retrieved_in_reasoning_step_id);
CREATE INDEX IF NOT EXISTS idx_quotes_chunk ON quotes(chunk_id);

-- Allow updating quotes (for message_id, citation_order when attaching to final message)
CREATE POLICY "Users can update own quotes"
  ON quotes FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- =============================================================================
-- 7. claim_evidence (FK to quotes - now quotes table is ready)
-- =============================================================================
CREATE TABLE claim_evidence (
  slot_item_id UUID NOT NULL REFERENCES slot_items(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (slot_item_id, quote_id)
);

CREATE INDEX idx_claim_evidence_quote ON claim_evidence(quote_id);

ALTER TABLE claim_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own claim_evidence"
  ON claim_evidence FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Users can insert own claim_evidence"
  ON claim_evidence FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can delete own claim_evidence"
  ON claim_evidence FOR DELETE
  USING (owner_id = auth.uid());

-- Trigger: set_owner_id for claim_evidence (no unique single column for trigger name conflict)
CREATE TRIGGER set_claim_evidence_owner
  BEFORE INSERT ON claim_evidence
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();

-- =============================================================================
-- 8. messages.thought_process
-- =============================================================================
ALTER TABLE messages ADD COLUMN IF NOT EXISTS thought_process JSONB DEFAULT NULL;
