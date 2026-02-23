-- Allow users to update page_edges in their conversations (e.g. set to_page_id when page already exists).
CREATE POLICY "Users can update page_edges from their conversations"
  ON page_edges FOR UPDATE
  USING (
    owner_id = (SELECT auth.uid()) AND
    EXISTS (
      SELECT 1 FROM pages p
      JOIN sources s ON s.id = p.source_id
      JOIN conversations c ON c.id = s.conversation_id
      WHERE p.id = page_edges.from_page_id
      AND c.owner_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    owner_id = (SELECT auth.uid()) AND
    EXISTS (
      SELECT 1 FROM pages p
      JOIN sources s ON s.id = p.source_id
      JOIN conversations c ON c.id = s.conversation_id
      WHERE p.id = page_edges.from_page_id
      AND c.owner_id = (SELECT auth.uid())
    )
  );
