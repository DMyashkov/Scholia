-- Migration 55: Drop rag_run_log table (debug table, not used by application logic)

DROP TABLE IF EXISTS rag_run_log CASCADE;
