-- Migration 30: Fix Supabase advisory warnings
-- - Function search_path: set immutable search_path on functions
-- - Vector extension: move from public to extensions schema

-- =============================================================================
-- 1. Fix functions with mutable search_path (set_owner_id, update_updated_at)
-- =============================================================================

CREATE OR REPLACE FUNCTION set_owner_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    NEW.owner_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- cancel_crawl_jobs_on_conversation_delete: fix if it exists (may have been created manually)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cancel_crawl_jobs_on_conversation_delete'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.cancel_crawl_jobs_on_conversation_delete() SET search_path = public';
  END IF;
END;
$$;

-- =============================================================================
-- 2. Move vector extension to extensions schema (if in public)
-- =============================================================================
-- Extensions in public schema can cause namespace pollution; Supabase recommends
-- keeping them in the extensions schema.

CREATE SCHEMA IF NOT EXISTS extensions;

-- Only move if vector is currently in public
DO $$
DECLARE
  ext_schema text;
BEGIN
  SELECT n.nspname INTO ext_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'vector';

  IF ext_schema = 'public' THEN
    ALTER EXTENSION vector SET SCHEMA extensions;
  END IF;
END;
$$;
