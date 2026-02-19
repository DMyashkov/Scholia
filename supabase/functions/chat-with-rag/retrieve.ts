import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChunkRow } from './types.ts';
import { embedBatch } from './embed.ts';
import { MATCH_CHUNKS_PER_QUERY } from './config.ts';
import { MATCH_CHUNKS_MERGED_CAP } from './config.ts';

export interface RetrieveResult {
  chunks: ChunkRow[];
  /** Chunk count per query (same order as queries) for transparency. */
  chunksPerSubquery: number[];
}

export async function doRetrieve(
  supabase: SupabaseClient,
  openaiKey: string,
  pageIds: string[],
  queries: string[],
  perQuery = MATCH_CHUNKS_PER_QUERY,
): Promise<RetrieveResult> {
  const embeddings = await embedBatch(openaiKey, queries);
  const chunkMap = new Map<string, ChunkRow>();
  const chunksPerSubquery: number[] = [];
  for (let i = 0; i < embeddings.length; i++) {
    const { data: matchedChunks } = await supabase.rpc('match_chunks', {
      query_embedding: embeddings[i],
      match_page_ids: pageIds,
      match_count: perQuery,
    });
    const list = (matchedChunks || []) as ChunkRow[];
    chunksPerSubquery.push(list.length);
    for (const c of list) {
      const dist = (c as { distance?: number }).distance ?? 1;
      const existing = chunkMap.get(c.id);
      if (!existing || ((existing as { distance?: number }).distance ?? 1) > dist) {
        chunkMap.set(c.id, { ...c, distance: dist });
      }
    }
  }
  const matchedList = Array.from(chunkMap.values()).sort(
    (a, b) => ((a as { distance?: number }).distance ?? 1) - ((b as { distance?: number }).distance ?? 1),
  );
  const chunks = matchedList.slice(0, MATCH_CHUNKS_MERGED_CAP);
  return { chunks, chunksPerSubquery };
}

// Previously: doRetrieveAndCreateQuotes created a quote row per chunk at retrieval time.
// In the new architecture, retrieval only returns chunks; quotes are created later
// at finalization for chunks actually cited in the final answer.
