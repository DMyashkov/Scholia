-- Migration 6: Fix conversation delete policy to allow guest conversations
-- File: supabase/migrations/006_fix_conversation_delete_policy.sql

-- Drop the existing policy
DROP POLICY IF EXISTS "Users can delete their own conversations" ON conversations;

-- Create updated policy that allows deletion of guest conversations (owner_id IS NULL)
CREATE POLICY "Users can delete their own conversations"
  ON conversations FOR DELETE
  USING (owner_id = auth.uid() OR owner_id IS NULL);
