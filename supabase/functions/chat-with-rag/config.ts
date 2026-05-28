export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
export const OPENAI_CHAT_MODEL = 'gpt-4o-mini';
export const MATCH_CHUNKS_PER_QUERY = 6;
// 8 subqueries × 6 chunks = 48 potential chunks; raise cap to 64 so the merged pool
// covers all queries before EXTRACT_CHUNKS_CAP (45) trims it for the LLM.
export const MATCH_CHUNKS_MERGED_CAP = 64;
export const LAST_MESSAGES_COUNT = 10;
export const PAGE_CONTEXT_CHARS = 350;


export const MAX_ITERATIONS = 5;
// All subqueries in a step share one embedBatch call (one OpenAI request) and all
// pgvector searches fire in parallel (Promise.all). Cost per step is dominated by
// the single LLM extraction call (~5-10 s), not by the number of subqueries.
// Raising these limits reduces step count, which reduces total LLM calls and wall time.
export const MAX_SUBQUERIES_PER_ITER = 24;
export const MAX_TOTAL_SUBQUERIES = 80;

// 22 mapping keys can now all run in one step: 1 extraction call instead of 3.
// Set to 22 so a full 22-key mapping completes in a single targeted step.
export const MAX_MAPPING_SUBQUERIES_PER_ITER = 22;
export const MAX_EXPANSIONS = 2;
export const STAGNATION_THRESHOLD = 0;
// Force answer when overall completeness is at or above this fraction and at least
// this many retrieval iterations have already run. Prevents burning extra steps on
// the last 5–10% of data when the edge function is near its wall-clock limit.
export const FORCE_ANSWER_COMPLETENESS_THRESHOLD = 0.90;
export const FORCE_ANSWER_MIN_ITERATIONS = 2;
export const INCLUDE_FILL_STATUS_BY_SLOT = true;

// Cap on evidence chunks passed to the extraction LLM each iteration.
// Without this the context grows unboundedly as chunks accumulate across steps.
export const EXTRACT_CHUNKS_CAP = 45;

export const FINAL_ANSWER_CHUNKS_CAP = 45;

export const SUGGESTION_MATCH_COUNT_MIN = 2;
export const SUGGESTION_MATCH_COUNT_MAX = 10;