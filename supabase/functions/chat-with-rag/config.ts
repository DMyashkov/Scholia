export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
export const OPENAI_CHAT_MODEL = 'gpt-4o-mini';
export const MATCH_CHUNKS_PER_QUERY = 5;
export const MATCH_CHUNKS_MERGED_CAP = 45;
export const LAST_MESSAGES_COUNT = 10;
export const PAGE_CONTEXT_CHARS = 350;


export const MAX_ITERATIONS = 6;
// Keep individual steps fast enough to avoid edge-function timeouts.
// 8 subqueries/step × ~1s each + LLM extraction ≈ 15-25s, well within limits.
// Mapping slots with many keys are automatically batched across multiple iterations.
export const MAX_SUBQUERIES_PER_ITER = 8;
export const MAX_TOTAL_SUBQUERIES = 80;

// Mapping per-key queries are the most expensive (one embedding + search each).
// Cap tightly so a 22-key slot processes ~8 keys/step across ~3 steps, not 22 at once.
export const MAX_MAPPING_SUBQUERIES_PER_ITER = 8;
export const MAX_EXPANSIONS = 2;
export const STAGNATION_THRESHOLD = 0; 
export const INCLUDE_FILL_STATUS_BY_SLOT = true;

// Cap on evidence chunks passed to the extraction LLM each iteration.
// Without this the context grows unboundedly as chunks accumulate across steps.
export const EXTRACT_CHUNKS_CAP = 45;

export const FINAL_ANSWER_CHUNKS_CAP = 80;

export const SUGGESTION_MATCH_COUNT_MIN = 2;
export const SUGGESTION_MATCH_COUNT_MAX = 10;