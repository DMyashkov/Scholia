export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
export const OPENAI_CHAT_MODEL = 'gpt-4o-mini';
export const MATCH_CHUNKS_PER_QUERY = 8;
export const MATCH_CHUNKS_MERGED_CAP = 64;
export const NEIGHBOR_WINDOW_CHARS = 3000;
export const NEIGHBOR_MAX_PER_ANCHOR = 3;
export const LAST_MESSAGES_COUNT = 10;
export const PAGE_CONTEXT_CHARS = 350;

export const MAX_ITERATIONS = 5;
export const MAX_SUBQUERIES_PER_ITER = 24;
export const MAX_TOTAL_SUBQUERIES = 80;

export const MAX_MAPPING_SUBQUERIES_PER_ITER = 22;
export const MAX_EXPANSIONS = 2;
export const STAGNATION_THRESHOLD = 0;
export const FORCE_ANSWER_COMPLETENESS_THRESHOLD = 0.90;
export const FORCE_ANSWER_MIN_ITERATIONS = 2;
export const INCLUDE_FILL_STATUS_BY_SLOT = true;

export const EXTRACT_CHUNKS_CAP = 45;

export const FINAL_ANSWER_CHUNKS_CAP = 45;

export const SUGGESTION_MATCH_COUNT_MIN = 2;
export const SUGGESTION_MATCH_COUNT_MAX = 10;

export const OPENAI_CALL_TIMEOUT_MS = 60_000;

export function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = OPENAI_CALL_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}