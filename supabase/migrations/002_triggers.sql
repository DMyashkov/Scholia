-- Migration 2: Triggers for auto-setting owner_id and updated_at

-- Function to set owner_id from auth.uid()
CREATE OR REPLACE FUNCTION set_owner_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    NEW.owner_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply owner_id triggers (only for tables that need it)
CREATE TRIGGER set_conversations_owner
  BEFORE INSERT ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();

CREATE TRIGGER set_messages_owner
  BEFORE INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();

CREATE TRIGGER set_sources_owner
  BEFORE INSERT ON sources
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();

CREATE TRIGGER set_crawl_jobs_owner
  BEFORE INSERT ON crawl_jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();

CREATE TRIGGER set_pages_owner
  BEFORE INSERT ON pages
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();

CREATE TRIGGER set_page_edges_owner
  BEFORE INSERT ON page_edges
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();

CREATE TRIGGER set_chunks_owner
  BEFORE INSERT ON chunks
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();

CREATE TRIGGER set_citations_owner
  BEFORE INSERT ON citations
  FOR EACH ROW
  EXECUTE FUNCTION set_owner_id();

-- Apply updated_at triggers
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_sources_updated_at
  BEFORE UPDATE ON sources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_crawl_jobs_updated_at
  BEFORE UPDATE ON crawl_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_pages_updated_at
  BEFORE UPDATE ON pages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();


