-- Add quote_id to claim_evidence so each evidence row links directly to the
-- pre-created quote row, removing the ambiguous chunk_id → quote lookup.
ALTER TABLE "public"."claim_evidence"
  ADD COLUMN IF NOT EXISTS "quote_id" "uuid" REFERENCES "public"."quotes"("id") ON DELETE SET NULL;
