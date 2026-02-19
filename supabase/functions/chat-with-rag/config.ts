export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
export const OPENAI_CHAT_MODEL = 'gpt-4o-mini';
export const MATCH_CHUNKS_PER_QUERY = 12;
export const MATCH_CHUNKS_MERGED_CAP = 45;
export const LAST_MESSAGES_COUNT = 10;
export const PAGE_CONTEXT_CHARS = 350;

/**
 * Max length for the quoted "statement" (snippet) in the UI.
 * Worker indexer uses CHUNK_MAX_CHARS = 600 per chunk; we show a subset so the quote is one (or two short) sentences.
 * context_before/context_after hold the rest. Keep this well under chunk size so the highlighted quote is a single claim.
 */
export const QUOTE_SNIPPET_MAX_CHARS = 280;

// Unfold v2 Evidence-First RAG
export const MAX_ITERATIONS = 6;
export const MAX_SUBQUERIES_PER_ITER = 30;
export const MAX_TOTAL_SUBQUERIES = 60;
export const MAX_EXPANSIONS = 2;
export const STAGNATION_THRESHOLD = 0; // no new slot_items in last iter
export const INCLUDE_FILL_STATUS_BY_SLOT = true;
