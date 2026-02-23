


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."count_encoded_discovered_by_edge_ids"("edge_ids" "uuid"[]) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF edge_ids IS NULL OR array_length(edge_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;
  RETURN (
    SELECT count(*)::bigint
    FROM encoded_discovered ed
    WHERE ed.page_edge_id = ANY(edge_ids)
  );
END;
$$;


ALTER FUNCTION "public"."count_encoded_discovered_by_edge_ids"("edge_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_encoded_discovered_with_embedding_by_edge_ids"("edge_ids" "uuid"[]) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF edge_ids IS NULL OR array_length(edge_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;
  RETURN (
    SELECT count(*)::bigint
    FROM encoded_discovered ed
    WHERE ed.page_edge_id = ANY(edge_ids)
      AND ed.embedding IS NOT NULL
  );
END;
$$;


ALTER FUNCTION "public"."count_encoded_discovered_with_embedding_by_edge_ids"("edge_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_encoded_discovered_page_edge_ids"("edge_ids" "uuid"[]) RETURNS TABLE("page_edge_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF edge_ids IS NULL OR array_length(edge_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT ed.page_edge_id
  FROM encoded_discovered ed
  WHERE ed.page_edge_id = ANY(edge_ids);
END;
$$;


ALTER FUNCTION "public"."get_encoded_discovered_page_edge_ids"("edge_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_encoded_discovered_with_embedding_page_edge_ids"("edge_ids" "uuid"[]) RETURNS TABLE("page_edge_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF edge_ids IS NULL OR array_length(edge_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT ed.page_edge_id
  FROM encoded_discovered ed
  WHERE ed.page_edge_id = ANY(edge_ids)
    AND ed.embedding IS NOT NULL;
END;
$$;


ALTER FUNCTION "public"."get_encoded_discovered_with_embedding_page_edge_ids"("edge_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_lead_chunks"("match_page_ids" "uuid"[]) RETURNS TABLE("id" "uuid", "page_id" "uuid", "content" "text", "source_id" "uuid", "page_title" "text", "page_path" "text", "page_url" "text", "source_domain" "text", "distance" double precision)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT DISTINCT ON (c.page_id)
    c.id,
    c.page_id,
    c.content,
    p.source_id,
    p.title AS page_title,
    p.path AS page_path,
    p.url AS page_url,
    s.domain AS source_domain,
    0::float AS distance
  FROM chunks c
  JOIN pages p ON p.id = c.page_id
  JOIN sources s ON s.id = p.source_id
  WHERE c.page_id = ANY(match_page_ids)
  ORDER BY c.page_id, length(c.content);
$$;


ALTER FUNCTION "public"."get_lead_chunks"("match_page_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_chunks"("query_embedding" "extensions"."vector", "match_page_ids" "uuid"[], "match_count" integer DEFAULT 10) RETURNS TABLE("id" "uuid", "page_id" "uuid", "content" "text", "source_id" "uuid", "page_title" "text", "page_path" "text", "page_url" "text", "source_domain" "text", "distance" double precision)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.page_id,
    c.content,
    p.source_id,
    p.title AS page_title,
    p.path AS page_path,
    p.url AS page_url,
    s.domain AS source_domain,
    (c.embedding <=> query_embedding) AS distance
  FROM chunks c
  JOIN pages p ON p.id = c.page_id
  JOIN sources s ON s.id = p.source_id
  WHERE c.embedding IS NOT NULL
    AND c.page_id = ANY(match_page_ids)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."match_chunks"("query_embedding" "extensions"."vector", "match_page_ids" "uuid"[], "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_discovered_links"("query_embedding" "extensions"."vector", "match_source_ids" "uuid"[], "match_count" integer DEFAULT 5) RETURNS TABLE("id" "uuid", "to_url" "text", "anchor_text" "text", "snippet" "text", "source_id" "uuid", "from_page_id" "uuid", "distance" double precision)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    ed.id,
    pe.to_url,
    ed.anchor_text,
    ed.snippet,
    p.source_id,
    pe.from_page_id,
    (ed.embedding <=> query_embedding)::float AS distance
  FROM encoded_discovered ed
  JOIN page_edges pe ON pe.id = ed.page_edge_id
  JOIN pages p ON p.id = pe.from_page_id
  WHERE p.source_id = ANY(match_source_ids)
    AND ed.embedding IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pages p2
      WHERE p2.source_id = p.source_id AND p2.url = pe.to_url
    )
  ORDER BY ed.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."match_discovered_links"("query_embedding" "extensions"."vector", "match_source_ids" "uuid"[], "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_discovered_links"("query_embedding" "extensions"."vector", "match_conversation_id" "uuid", "match_source_ids" "uuid"[], "match_count" integer DEFAULT 5) RETURNS TABLE("id" "uuid", "to_url" "text", "anchor_text" "text", "context_snippet" "text", "source_id" "uuid", "from_page_id" "uuid", "distance" double precision)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    dl.id,
    dl.to_url,
    dl.anchor_text,
    dl.context_snippet,
    dl.source_id,
    dl.from_page_id,
    (dl.embedding <=> query_embedding)::float AS distance
  FROM discovered_links dl
  WHERE dl.conversation_id = match_conversation_id
    AND dl.source_id = ANY(match_source_ids)
    AND dl.embedding IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pages p
      WHERE p.source_id = dl.source_id
        AND p.conversation_id = dl.conversation_id
        AND p.url = dl.to_url
    )
  ORDER BY dl.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."match_discovered_links"("query_embedding" "extensions"."vector", "match_conversation_id" "uuid", "match_source_ids" "uuid"[], "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_encoded_discovered_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    NEW.owner_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_encoded_discovered_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_owner_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required';
    END IF;
    NEW.owner_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_owner_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_conversation_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE conversations
  SET updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_conversation_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."chunks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "page_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "start_index" integer,
    "end_index" integer,
    "embedding" "extensions"."vector"(1536),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "owner_id" "uuid" NOT NULL
);


ALTER TABLE "public"."chunks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."claim_evidence" (
    "slot_item_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "chunk_id" "uuid" NOT NULL
);


ALTER TABLE "public"."claim_evidence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "title" "text" DEFAULT 'New Research'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dynamic_mode" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crawl_jobs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "source_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "total_pages" integer,
    "error_message" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "discovered_count" integer DEFAULT 0 NOT NULL,
    "indexed_count" integer DEFAULT 0 NOT NULL,
    "last_activity_at" timestamp with time zone,
    "encoding_chunks_done" integer DEFAULT 0 NOT NULL,
    "encoding_chunks_total" integer DEFAULT 0,
    "encoding_discovered_done" integer DEFAULT 0 NOT NULL,
    "encoding_discovered_total" integer DEFAULT 0,
    "explicit_crawl_urls" "text"[],
    CONSTRAINT "crawl_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'indexing'::"text", 'encoding'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."crawl_jobs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."crawl_jobs"."explicit_crawl_urls" IS 'When set: crawl these URLs (override source.initial_url). When null: use source.initial_url and discover links. Used for recrawl (all page URLs) and add-page (single URL).';



CREATE TABLE IF NOT EXISTS "public"."encoded_discovered" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "page_edge_id" "uuid" NOT NULL,
    "anchor_text" "text",
    "snippet" "text" NOT NULL,
    "embedding" "extensions"."vector"(1536),
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."encoded_discovered" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "was_multi_step" boolean DEFAULT false NOT NULL,
    "follows_message_id" "uuid",
    "scraped_page_display" "text",
    "suggested_page" "jsonb",
    "thought_process" "jsonb",
    CONSTRAINT "messages_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text"])))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."page_edges" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "from_page_id" "uuid" NOT NULL,
    "to_page_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "to_url" "text"
);


ALTER TABLE "public"."page_edges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pages" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "source_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "title" "text",
    "path" "text" NOT NULL,
    "content" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    CONSTRAINT "pages_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'crawling'::"text", 'indexed'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."pages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid",
    "page_id" "uuid" NOT NULL,
    "snippet" "text" NOT NULL,
    "page_title" "text" DEFAULT ''::"text" NOT NULL,
    "page_path" "text" DEFAULT ''::"text" NOT NULL,
    "domain" "text" DEFAULT ''::"text" NOT NULL,
    "page_url" "text",
    "context_before" "text",
    "context_after" "text",
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "retrieved_in_reasoning_step_id" "uuid",
    "citation_order" integer,
    "chunk_id" "uuid"
);


ALTER TABLE "public"."quotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reasoning_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "root_message_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "iteration_number" integer NOT NULL,
    "action" "text" NOT NULL,
    "why" "text",
    "completeness_score" real,
    "expansion_recommended" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reasoning_steps_action_check" CHECK (("action" = ANY (ARRAY['retrieve'::"text", 'expand_corpus'::"text", 'clarify'::"text", 'answer'::"text"])))
);


ALTER TABLE "public"."reasoning_steps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reasoning_subqueries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reasoning_step_id" "uuid" NOT NULL,
    "slot_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "query_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "strategy" "text"
);


ALTER TABLE "public"."reasoning_subqueries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."slot_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slot_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "key" "text",
    "value_json" "jsonb" NOT NULL,
    "confidence" real DEFAULT 1.0 NOT NULL,
    "complete" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."slot_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "root_message_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "description" "text",
    "depends_on_slot_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "target_item_count" integer DEFAULT 0 NOT NULL,
    "current_item_count" integer DEFAULT 0 NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "finished_querying" boolean DEFAULT false NOT NULL,
    "last_queries" "text"[] DEFAULT '{}'::"text"[],
    "items_per_key" integer,
    CONSTRAINT "slots_type_check" CHECK (("type" = ANY (ARRAY['scalar'::"text", 'list'::"text", 'mapping'::"text"])))
);


ALTER TABLE "public"."slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sources" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "initial_url" "text" NOT NULL,
    "domain" "text" NOT NULL,
    "crawl_depth" "text" DEFAULT 'medium'::"text" NOT NULL,
    "same_domain_only" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_label" "text",
    "conversation_id" "uuid" NOT NULL,
    "suggestion_mode" "text" DEFAULT 'surface'::"text" NOT NULL,
    CONSTRAINT "sources_crawl_depth_check" CHECK (("crawl_depth" = ANY (ARRAY['shallow'::"text", 'medium'::"text", 'deep'::"text", 'singular'::"text", 'dynamic'::"text"]))),
    CONSTRAINT "sources_suggestion_mode_check" CHECK (("suggestion_mode" = ANY (ARRAY['surface'::"text", 'dive'::"text"])))
);


ALTER TABLE "public"."sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_settings" (
    "owner_id" "uuid" NOT NULL,
    "sidebar_width" integer DEFAULT 600 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "copy_include_evidence" boolean DEFAULT true NOT NULL,
    "suggested_page_candidates" integer DEFAULT 5 NOT NULL,
    CONSTRAINT "user_settings_suggested_page_candidates_check" CHECK (("suggested_page_candidates" = ANY (ARRAY[5, 10])))
);


ALTER TABLE "public"."user_settings" OWNER TO "postgres";


ALTER TABLE ONLY "public"."chunks"
    ADD CONSTRAINT "chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."claim_evidence"
    ADD CONSTRAINT "claim_evidence_pkey" PRIMARY KEY ("slot_item_id", "chunk_id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crawl_jobs"
    ADD CONSTRAINT "crawl_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."encoded_discovered"
    ADD CONSTRAINT "encoded_discovered_page_edge_id_key" UNIQUE ("page_edge_id");



ALTER TABLE ONLY "public"."encoded_discovered"
    ADD CONSTRAINT "encoded_discovered_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."page_edges"
    ADD CONSTRAINT "page_edges_from_page_to_url_key" UNIQUE ("from_page_id", "to_url");



ALTER TABLE ONLY "public"."page_edges"
    ADD CONSTRAINT "page_edges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_source_url_key" UNIQUE ("source_id", "url");



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reasoning_steps"
    ADD CONSTRAINT "reasoning_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reasoning_subqueries"
    ADD CONSTRAINT "reasoning_subqueries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slot_items"
    ADD CONSTRAINT "slot_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slots"
    ADD CONSTRAINT "slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slots"
    ADD CONSTRAINT "slots_root_message_id_name_key" UNIQUE ("root_message_id", "name");



ALTER TABLE ONLY "public"."sources"
    ADD CONSTRAINT "sources_conversation_initial_url_key" UNIQUE ("conversation_id", "initial_url");



ALTER TABLE ONLY "public"."sources"
    ADD CONSTRAINT "sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_pkey" PRIMARY KEY ("owner_id");



CREATE INDEX "idx_chunks_embedding_hnsw" ON "public"."chunks" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WHERE ("embedding" IS NOT NULL);



CREATE INDEX "idx_chunks_page" ON "public"."chunks" USING "btree" ("page_id");



CREATE INDEX "idx_claim_evidence_chunk" ON "public"."claim_evidence" USING "btree" ("chunk_id");



CREATE INDEX "idx_conversations_owner" ON "public"."conversations" USING "btree" ("owner_id");



CREATE INDEX "idx_conversations_updated" ON "public"."conversations" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_crawl_jobs_owner" ON "public"."crawl_jobs" USING "btree" ("owner_id");



CREATE INDEX "idx_crawl_jobs_source" ON "public"."crawl_jobs" USING "btree" ("source_id");



CREATE INDEX "idx_crawl_jobs_status" ON "public"."crawl_jobs" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['queued'::"text", 'running'::"text"]));



CREATE INDEX "idx_encoded_discovered_embedding" ON "public"."encoded_discovered" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WHERE ("embedding" IS NOT NULL);



CREATE INDEX "idx_encoded_discovered_page_edge" ON "public"."encoded_discovered" USING "btree" ("page_edge_id");



CREATE INDEX "idx_messages_conversation" ON "public"."messages" USING "btree" ("conversation_id", "created_at");



CREATE INDEX "idx_messages_owner" ON "public"."messages" USING "btree" ("owner_id");



CREATE INDEX "idx_page_edges_from_page" ON "public"."page_edges" USING "btree" ("from_page_id");



CREATE INDEX "idx_page_edges_to" ON "public"."page_edges" USING "btree" ("to_page_id");



CREATE INDEX "idx_pages_owner" ON "public"."pages" USING "btree" ("owner_id");



CREATE INDEX "idx_pages_source" ON "public"."pages" USING "btree" ("source_id");



CREATE INDEX "idx_quotes_chunk" ON "public"."quotes" USING "btree" ("chunk_id");



CREATE INDEX "idx_quotes_message" ON "public"."quotes" USING "btree" ("message_id");



CREATE INDEX "idx_quotes_page" ON "public"."quotes" USING "btree" ("page_id");



CREATE INDEX "idx_quotes_retrieved_in_step" ON "public"."quotes" USING "btree" ("retrieved_in_reasoning_step_id");



CREATE INDEX "idx_reasoning_steps_owner" ON "public"."reasoning_steps" USING "btree" ("owner_id");



CREATE INDEX "idx_reasoning_steps_root_message" ON "public"."reasoning_steps" USING "btree" ("root_message_id");



CREATE INDEX "idx_reasoning_subqueries_owner" ON "public"."reasoning_subqueries" USING "btree" ("owner_id");



CREATE INDEX "idx_reasoning_subqueries_slot" ON "public"."reasoning_subqueries" USING "btree" ("slot_id");



CREATE INDEX "idx_reasoning_subqueries_step" ON "public"."reasoning_subqueries" USING "btree" ("reasoning_step_id");



CREATE INDEX "idx_slot_items_owner" ON "public"."slot_items" USING "btree" ("owner_id");



CREATE INDEX "idx_slot_items_slot" ON "public"."slot_items" USING "btree" ("slot_id");



CREATE INDEX "idx_slots_owner" ON "public"."slots" USING "btree" ("owner_id");



CREATE INDEX "idx_slots_root_message" ON "public"."slots" USING "btree" ("root_message_id");



CREATE INDEX "idx_sources_conversation" ON "public"."sources" USING "btree" ("conversation_id");



CREATE INDEX "idx_sources_owner" ON "public"."sources" USING "btree" ("owner_id");



CREATE OR REPLACE TRIGGER "set_chunks_owner" BEFORE INSERT ON "public"."chunks" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_id"();



CREATE OR REPLACE TRIGGER "set_claim_evidence_owner" BEFORE INSERT ON "public"."claim_evidence" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_id"();



CREATE OR REPLACE TRIGGER "set_conversations_owner" BEFORE INSERT ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_id"();



CREATE OR REPLACE TRIGGER "set_crawl_jobs_owner" BEFORE INSERT ON "public"."crawl_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_id"();



CREATE OR REPLACE TRIGGER "set_encoded_discovered_owner" BEFORE INSERT ON "public"."encoded_discovered" FOR EACH ROW EXECUTE FUNCTION "public"."set_encoded_discovered_owner"();



CREATE OR REPLACE TRIGGER "set_messages_owner" BEFORE INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_id"();



CREATE OR REPLACE TRIGGER "set_page_edges_owner" BEFORE INSERT ON "public"."page_edges" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_id"();



CREATE OR REPLACE TRIGGER "set_pages_owner" BEFORE INSERT ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_id"();



CREATE OR REPLACE TRIGGER "set_quotes_owner" BEFORE INSERT ON "public"."quotes" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_id"();



CREATE OR REPLACE TRIGGER "set_reasoning_steps_owner" BEFORE INSERT ON "public"."reasoning_steps" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_id"();



CREATE OR REPLACE TRIGGER "set_reasoning_subqueries_owner" BEFORE INSERT ON "public"."reasoning_subqueries" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_id"();



CREATE OR REPLACE TRIGGER "set_slot_items_owner" BEFORE INSERT ON "public"."slot_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_id"();



CREATE OR REPLACE TRIGGER "set_slots_owner" BEFORE INSERT ON "public"."slots" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_id"();



CREATE OR REPLACE TRIGGER "set_sources_owner" BEFORE INSERT ON "public"."sources" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_id"();



CREATE OR REPLACE TRIGGER "touch_conversation_on_message" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."touch_conversation_updated_at"();



CREATE OR REPLACE TRIGGER "update_conversations_updated_at" BEFORE UPDATE ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "update_crawl_jobs_updated_at" BEFORE UPDATE ON "public"."crawl_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "update_pages_updated_at" BEFORE UPDATE ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "update_sources_updated_at" BEFORE UPDATE ON "public"."sources" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



ALTER TABLE ONLY "public"."chunks"
    ADD CONSTRAINT "chunks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chunks"
    ADD CONSTRAINT "chunks_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claim_evidence"
    ADD CONSTRAINT "claim_evidence_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claim_evidence"
    ADD CONSTRAINT "claim_evidence_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claim_evidence"
    ADD CONSTRAINT "claim_evidence_slot_item_id_fkey" FOREIGN KEY ("slot_item_id") REFERENCES "public"."slot_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crawl_jobs"
    ADD CONSTRAINT "crawl_jobs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crawl_jobs"
    ADD CONSTRAINT "crawl_jobs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."encoded_discovered"
    ADD CONSTRAINT "encoded_discovered_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."encoded_discovered"
    ADD CONSTRAINT "encoded_discovered_page_edge_id_fkey" FOREIGN KEY ("page_edge_id") REFERENCES "public"."page_edges"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_follows_message_id_fkey" FOREIGN KEY ("follows_message_id") REFERENCES "public"."messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_edges"
    ADD CONSTRAINT "page_edges_from_page_id_fkey" FOREIGN KEY ("from_page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_edges"
    ADD CONSTRAINT "page_edges_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_retrieved_in_reasoning_step_id_fkey" FOREIGN KEY ("retrieved_in_reasoning_step_id") REFERENCES "public"."reasoning_steps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reasoning_steps"
    ADD CONSTRAINT "reasoning_steps_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reasoning_steps"
    ADD CONSTRAINT "reasoning_steps_root_message_id_fkey" FOREIGN KEY ("root_message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reasoning_subqueries"
    ADD CONSTRAINT "reasoning_subqueries_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reasoning_subqueries"
    ADD CONSTRAINT "reasoning_subqueries_reasoning_step_id_fkey" FOREIGN KEY ("reasoning_step_id") REFERENCES "public"."reasoning_steps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reasoning_subqueries"
    ADD CONSTRAINT "reasoning_subqueries_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slot_items"
    ADD CONSTRAINT "slot_items_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slot_items"
    ADD CONSTRAINT "slot_items_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slots"
    ADD CONSTRAINT "slots_depends_on_slot_id_fkey" FOREIGN KEY ("depends_on_slot_id") REFERENCES "public"."slots"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."slots"
    ADD CONSTRAINT "slots_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slots"
    ADD CONSTRAINT "slots_root_message_id_fkey" FOREIGN KEY ("root_message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sources"
    ADD CONSTRAINT "sources_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sources"
    ADD CONSTRAINT "sources_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Users can create chunks" ON "public"."chunks" FOR INSERT WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can create conversations" ON "public"."conversations" FOR INSERT WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can create crawl jobs" ON "public"."crawl_jobs" FOR INSERT WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can create edges" ON "public"."page_edges" FOR INSERT WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can create messages in their conversations" ON "public"."messages" FOR INSERT WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE (("conversations"."id" = "messages"."conversation_id") AND ("conversations"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can create pages" ON "public"."pages" FOR INSERT WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can create quotes" ON "public"."quotes" FOR INSERT WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can create sources" ON "public"."sources" FOR INSERT WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can delete chunks from their conversation pages" ON "public"."chunks" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (("public"."pages" "p"
     JOIN "public"."sources" "s" ON (("s"."id" = "p"."source_id")))
     JOIN "public"."conversations" "c" ON (("c"."id" = "s"."conversation_id")))
  WHERE (("p"."id" = "chunks"."page_id") AND ("c"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can delete encoded_discovered from their pages" ON "public"."encoded_discovered" FOR DELETE USING ((("owner_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ((("public"."page_edges" "pe"
     JOIN "public"."pages" "p" ON (("p"."id" = "pe"."from_page_id")))
     JOIN "public"."sources" "s" ON (("s"."id" = "p"."source_id")))
     JOIN "public"."conversations" "c" ON (("c"."id" = "s"."conversation_id")))
  WHERE (("pe"."id" = "encoded_discovered"."page_edge_id") AND ("c"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "Users can delete own claim_evidence" ON "public"."claim_evidence" FOR DELETE USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can delete page_edges from their conversations" ON "public"."page_edges" FOR DELETE USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM (("public"."pages" "p"
     JOIN "public"."sources" "s" ON (("s"."id" = "p"."source_id")))
     JOIN "public"."conversations" "c" ON (("c"."id" = "s"."conversation_id")))
  WHERE (("p"."id" = "page_edges"."from_page_id") AND ("c"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can delete pages from their sources" ON "public"."pages" FOR DELETE USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM ("public"."sources" "s"
     JOIN "public"."conversations" "c" ON (("c"."id" = "s"."conversation_id")))
  WHERE (("s"."id" = "pages"."source_id") AND ("c"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can delete their own conversations" ON "public"."conversations" FOR DELETE USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can delete their own messages" ON "public"."messages" FOR DELETE USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can delete their own quotes" ON "public"."quotes" FOR DELETE USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can delete their own sources" ON "public"."sources" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."conversations" "c"
  WHERE (("c"."id" = "sources"."conversation_id") AND ("c"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can insert encoded_discovered" ON "public"."encoded_discovered" FOR INSERT WITH CHECK ((("owner_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ((("public"."page_edges" "pe"
     JOIN "public"."pages" "p" ON (("p"."id" = "pe"."from_page_id")))
     JOIN "public"."sources" "s" ON (("s"."id" = "p"."source_id")))
     JOIN "public"."conversations" "c" ON (("c"."id" = "s"."conversation_id")))
  WHERE (("pe"."id" = "encoded_discovered"."page_edge_id") AND ("c"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "Users can insert own claim_evidence" ON "public"."claim_evidence" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can insert own reasoning_steps" ON "public"."reasoning_steps" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can insert own reasoning_subqueries" ON "public"."reasoning_subqueries" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can insert own settings" ON "public"."user_settings" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "Users can insert own slot_items" ON "public"."slot_items" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can insert own slots" ON "public"."slots" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can update encoded_discovered" ON "public"."encoded_discovered" FOR UPDATE USING ((("owner_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ((("public"."page_edges" "pe"
     JOIN "public"."pages" "p" ON (("p"."id" = "pe"."from_page_id")))
     JOIN "public"."sources" "s" ON (("s"."id" = "p"."source_id")))
     JOIN "public"."conversations" "c" ON (("c"."id" = "s"."conversation_id")))
  WHERE (("pe"."id" = "encoded_discovered"."page_edge_id") AND ("c"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "Users can update own quotes" ON "public"."quotes" FOR UPDATE USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can update own settings" ON "public"."user_settings" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "Users can update own slots" ON "public"."slots" FOR UPDATE USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own conversations" ON "public"."conversations" FOR UPDATE USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update their own crawl jobs" ON "public"."crawl_jobs" FOR UPDATE USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update their own messages" ON "public"."messages" FOR UPDATE USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update their own pages" ON "public"."pages" FOR UPDATE USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update their own sources" ON "public"."sources" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."conversations" "c"
  WHERE (("c"."id" = "sources"."conversation_id") AND ("c"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can view chunks from their pages" ON "public"."chunks" FOR SELECT USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can view edges from their conversations" ON "public"."page_edges" FOR SELECT USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM (("public"."pages" "p"
     JOIN "public"."sources" "s" ON (("s"."id" = "p"."source_id")))
     JOIN "public"."conversations" "c" ON (("c"."id" = "s"."conversation_id")))
  WHERE (("p"."id" = "page_edges"."from_page_id") AND ("c"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can view encoded_discovered from their pages" ON "public"."encoded_discovered" FOR SELECT USING ((("owner_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ((("public"."page_edges" "pe"
     JOIN "public"."pages" "p" ON (("p"."id" = "pe"."from_page_id")))
     JOIN "public"."sources" "s" ON (("s"."id" = "p"."source_id")))
     JOIN "public"."conversations" "c" ON (("c"."id" = "s"."conversation_id")))
  WHERE (("pe"."id" = "encoded_discovered"."page_edge_id") AND ("c"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view messages in their conversations" ON "public"."messages" FOR SELECT USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE (("conversations"."id" = "messages"."conversation_id") AND ("conversations"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can view own claim_evidence" ON "public"."claim_evidence" FOR SELECT USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can view own reasoning_steps" ON "public"."reasoning_steps" FOR SELECT USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can view own reasoning_subqueries" ON "public"."reasoning_subqueries" FOR SELECT USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can view own settings" ON "public"."user_settings" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "Users can view own slot_items" ON "public"."slot_items" FOR SELECT USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can view own slots" ON "public"."slots" FOR SELECT USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can view pages from their sources" ON "public"."pages" FOR SELECT USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM ("public"."sources" "s"
     JOIN "public"."conversations" "c" ON (("c"."id" = "s"."conversation_id")))
  WHERE (("s"."id" = "pages"."source_id") AND ("c"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can view quotes from their messages" ON "public"."quotes" FOR SELECT USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can view their own conversations" ON "public"."conversations" FOR SELECT USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can view their own crawl jobs" ON "public"."crawl_jobs" FOR SELECT USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can view their own sources" ON "public"."sources" FOR SELECT USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."claim_evidence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crawl_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."encoded_discovered" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."page_edges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quotes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reasoning_steps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reasoning_subqueries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."slot_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."slots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_settings" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."crawl_jobs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."encoded_discovered";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."page_edges";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."pages";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";















































































































































































































































































































































































































































































































GRANT ALL ON FUNCTION "public"."count_encoded_discovered_by_edge_ids"("edge_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."count_encoded_discovered_by_edge_ids"("edge_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_encoded_discovered_by_edge_ids"("edge_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."count_encoded_discovered_with_embedding_by_edge_ids"("edge_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."count_encoded_discovered_with_embedding_by_edge_ids"("edge_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_encoded_discovered_with_embedding_by_edge_ids"("edge_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_encoded_discovered_page_edge_ids"("edge_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_encoded_discovered_page_edge_ids"("edge_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_encoded_discovered_page_edge_ids"("edge_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_encoded_discovered_with_embedding_page_edge_ids"("edge_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_encoded_discovered_with_embedding_page_edge_ids"("edge_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_encoded_discovered_with_embedding_page_edge_ids"("edge_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_lead_chunks"("match_page_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_lead_chunks"("match_page_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_lead_chunks"("match_page_ids" "uuid"[]) TO "service_role";












GRANT ALL ON FUNCTION "public"."set_encoded_discovered_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_encoded_discovered_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_encoded_discovered_owner"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_owner_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_owner_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_owner_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_conversation_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_conversation_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_conversation_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";






























GRANT ALL ON TABLE "public"."chunks" TO "anon";
GRANT ALL ON TABLE "public"."chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."chunks" TO "service_role";



GRANT ALL ON TABLE "public"."claim_evidence" TO "anon";
GRANT ALL ON TABLE "public"."claim_evidence" TO "authenticated";
GRANT ALL ON TABLE "public"."claim_evidence" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."crawl_jobs" TO "anon";
GRANT ALL ON TABLE "public"."crawl_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."crawl_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."encoded_discovered" TO "anon";
GRANT ALL ON TABLE "public"."encoded_discovered" TO "authenticated";
GRANT ALL ON TABLE "public"."encoded_discovered" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."page_edges" TO "anon";
GRANT ALL ON TABLE "public"."page_edges" TO "authenticated";
GRANT ALL ON TABLE "public"."page_edges" TO "service_role";



GRANT ALL ON TABLE "public"."pages" TO "anon";
GRANT ALL ON TABLE "public"."pages" TO "authenticated";
GRANT ALL ON TABLE "public"."pages" TO "service_role";



GRANT ALL ON TABLE "public"."quotes" TO "anon";
GRANT ALL ON TABLE "public"."quotes" TO "authenticated";
GRANT ALL ON TABLE "public"."quotes" TO "service_role";



GRANT ALL ON TABLE "public"."reasoning_steps" TO "anon";
GRANT ALL ON TABLE "public"."reasoning_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."reasoning_steps" TO "service_role";



GRANT ALL ON TABLE "public"."reasoning_subqueries" TO "anon";
GRANT ALL ON TABLE "public"."reasoning_subqueries" TO "authenticated";
GRANT ALL ON TABLE "public"."reasoning_subqueries" TO "service_role";



GRANT ALL ON TABLE "public"."slot_items" TO "anon";
GRANT ALL ON TABLE "public"."slot_items" TO "authenticated";
GRANT ALL ON TABLE "public"."slot_items" TO "service_role";



GRANT ALL ON TABLE "public"."slots" TO "anon";
GRANT ALL ON TABLE "public"."slots" TO "authenticated";
GRANT ALL ON TABLE "public"."slots" TO "service_role";



GRANT ALL ON TABLE "public"."sources" TO "anon";
GRANT ALL ON TABLE "public"."sources" TO "authenticated";
GRANT ALL ON TABLE "public"."sources" TO "service_role";



GRANT ALL ON TABLE "public"."user_settings" TO "anon";
GRANT ALL ON TABLE "public"."user_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."user_settings" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";


