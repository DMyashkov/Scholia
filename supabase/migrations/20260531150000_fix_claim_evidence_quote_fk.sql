-- Fix FK on claim_evidence.quote_id: use CASCADE instead of SET NULL so that
-- deleting a quote (via message delete cascade) removes the evidence row rather
-- than trying to null a NOT NULL column.
ALTER TABLE "public"."claim_evidence"
  DROP CONSTRAINT IF EXISTS "claim_evidence_quote_id_fkey";

ALTER TABLE "public"."claim_evidence"
  ADD CONSTRAINT "claim_evidence_quote_id_fkey"
  FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE CASCADE;
