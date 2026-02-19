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

function distanceOf(c: ChunkRow): number {
  return (c as { distance?: number }).distance ?? 1;
}

/**
 * Fair allocation: take up to floor(cap/numQueries) best chunks per query so every query
 * is represented when we hit the cap, then fill remaining slots with next-best by distance.
 */
function capWithFairAllocation(
  chunkMap: Map<string, ChunkRow>,
  chunksByQueryIndex: ChunkRow[][],
  cap: number,
): ChunkRow[] {
  const numQueries = chunksByQueryIndex.length;
  if (numQueries === 0) return [];
  const perQueryQuota = Math.max(1, Math.floor(cap / numQueries));
  const selectedIds = new Set<string>();

  for (let i = 0; i < chunksByQueryIndex.length; i++) {
    const list = chunksByQueryIndex[i]
      .slice()
      .sort((a, b) => distanceOf(a) - distanceOf(b));
    let taken = 0;
    for (const c of list) {
      if (taken >= perQueryQuota) break;
      if (selectedIds.has(c.id)) continue;
      selectedIds.add(c.id);
      taken++;
    }
  }

  const selected = Array.from(selectedIds)
    .map((id) => chunkMap.get(id)!)
    .filter(Boolean)
    .sort((a, b) => distanceOf(a) - distanceOf(b));

  if (selected.length >= cap) return selected.slice(0, cap);
  const remaining = Array.from(chunkMap.values())
    .filter((c) => !selectedIds.has(c.id))
    .sort((a, b) => distanceOf(a) - distanceOf(b));
  const fill = remaining.slice(0, cap - selected.length);
  return [...selected, ...fill].sort((a, b) => distanceOf(a) - distanceOf(b));
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
  const chunksByQueryIndex: ChunkRow[][] = [];
  const chunksPerSubquery: number[] = [];
  for (let i = 0; i < embeddings.length; i++) {
    const { data: matchedChunks } = await supabase.rpc('match_chunks', {
      query_embedding: embeddings[i],
      match_page_ids: pageIds,
      match_count: perQuery,
    });
    const list = (matchedChunks || []) as ChunkRow[];
    chunksPerSubquery.push(list.length);
    chunksByQueryIndex.push(list);
    for (const c of list) {
      const dist = distanceOf(c);
      const existing = chunkMap.get(c.id);
      if (!existing || distanceOf(existing) > dist) {
        chunkMap.set(c.id, { ...c, distance: dist });
      }
    }
  }
  const chunks = capWithFairAllocation(
    chunkMap,
    chunksByQueryIndex,
    MATCH_CHUNKS_MERGED_CAP,
  );
  return { chunks, chunksPerSubquery };
}

// Previously: doRetrieveAndCreateQuotes created a quote row per chunk at retrieval time.
// In the new architecture, retrieval only returns chunks; quotes are created later
// at finalization for chunks actually cited in the final answer.
