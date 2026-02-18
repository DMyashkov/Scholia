import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChunkRow } from './types.ts';
import { embedBatch } from './embed.ts';
import { MATCH_CHUNKS_PER_QUERY } from './config.ts';
import { MATCH_CHUNKS_MERGED_CAP } from './config.ts';

export async function doRetrieve(
  supabase: SupabaseClient,
  openaiKey: string,
  pageIds: string[],
  queries: string[],
  perQuery = MATCH_CHUNKS_PER_QUERY,
): Promise<ChunkRow[]> {
  const embeddings = await embedBatch(openaiKey, queries);
  const chunkMap = new Map<string, ChunkRow>();
  for (let i = 0; i < embeddings.length; i++) {
    const { data: matchedChunks } = await supabase.rpc('match_chunks', {
      query_embedding: embeddings[i],
      match_page_ids: pageIds,
      match_count: perQuery,
    });
    const list = (matchedChunks || []) as ChunkRow[];
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
  return matchedList.slice(0, MATCH_CHUNKS_MERGED_CAP);
}
