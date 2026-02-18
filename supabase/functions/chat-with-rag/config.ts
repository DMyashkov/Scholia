export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
export const OPENAI_CHAT_MODEL = 'gpt-4o-mini';
export const MATCH_CHUNKS_PER_QUERY = 12;
export const MATCH_CHUNKS_PER_QUERY_ROUND2 = 10;
export const MATCH_CHUNKS_MERGED_CAP = 45;
export const ROUND2_QUERIES_CAP = 10;
export const LAST_MESSAGES_COUNT = 10;
export const PAGE_CONTEXT_CHARS = 350;
