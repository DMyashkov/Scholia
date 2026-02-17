-- Migration 52: Drop cancel_crawl_jobs_on_conversation_delete trigger
-- The trigger references crawl_jobs.conversation_id which was dropped in migration 043.
-- Crawl jobs are now cascade-deleted via sources (conversation -> sources -> crawl_jobs).
DROP TRIGGER IF EXISTS trigger_cancel_crawl_jobs_on_conversation_delete ON conversations;
DROP FUNCTION IF EXISTS cancel_crawl_jobs_on_conversation_delete();
