-- Allow users to delete graph data from their conversations (required for recrawl)
-- Recrawl runs from the frontend and must delete pages, edges, chunks, discovered_links

-- Chunks: delete via page (user owns conversation that owns page)
CREATE POLICY "Users can delete chunks from their conversation pages"
  ON chunks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM pages p
      JOIN conversations c ON c.id = p.conversation_id
      WHERE p.id = chunks.page_id
      AND (c.owner_id = auth.uid() OR c.owner_id IS NULL)
    )
  );

-- discovered_links: no DELETE policy existed
CREATE POLICY "Users can delete discovered_links from their conversations"
  ON discovered_links FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = discovered_links.conversation_id
      AND (c.owner_id = auth.uid() OR c.owner_id IS NULL)
    )
  );

-- page_edges: only had SELECT
CREATE POLICY "Users can delete page_edges from their conversations"
  ON page_edges FOR DELETE
  USING (
    (owner_id = auth.uid() OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = page_edges.conversation_id
      AND (c.owner_id = auth.uid() OR c.owner_id IS NULL)
    )
  );

-- pages: only had SELECT, INSERT, UPDATE
CREATE POLICY "Users can delete pages from their conversations"
  ON pages FOR DELETE
  USING (
    (owner_id = auth.uid() OR owner_id IS NULL) AND
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = pages.conversation_id
      AND (c.owner_id = auth.uid() OR c.owner_id IS NULL)
    )
  );
