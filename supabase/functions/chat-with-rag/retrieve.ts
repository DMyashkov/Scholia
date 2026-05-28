import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChunkRow, EvidenceChunkProvenance } from './types.ts';
import { embedBatch } from './embed.ts';
import { MATCH_CHUNKS_PER_QUERY } from './config.ts';
import { MATCH_CHUNKS_MERGED_CAP } from './config.ts';
import { capWithFairAllocation } from './utils.ts';

export type RetrieveSubquery = { slot: string; query: string };

export interface RetrieveResult {
  chunks: ChunkRow[];
  chunksPerSubquery: number[];
  provenanceByChunkId: Map<string, EvidenceChunkProvenance[]>;
}

function distanceOf(c: ChunkRow): number {
  return (c as { distance?: number }).distance ?? 1;
}

export async function doRetrieve(
  supabase: SupabaseClient,
  openaiKey: string,
  pageIds: string[],
  subqueries: RetrieveSubquery[],
  perQuery = MATCH_CHUNKS_PER_QUERY,
): Promise<RetrieveResult> {
  const queries = subqueries.map((s) => s.query);
  const embeddings = await embedBatch(openaiKey, queries);
  const chunkMap = new Map<string, ChunkRow>();
  const chunksByQueryIndex: ChunkRow[][] = new Array(embeddings.length).fill(null);
  const chunksPerSubquery: number[] = new Array(embeddings.length).fill(0);
  const provenanceByChunkId = new Map<string, EvidenceChunkProvenance[]>();

  // Fire all pgvector searches in parallel instead of sequentially
  await Promise.all(embeddings.map(async (embedding, i) => {
    const { slot, query } = subqueries[i];
    const { data: matchedChunks } = await supabase.rpc('match_chunks', {
      query_embedding: embedding,
      match_page_ids: pageIds,
      match_count: perQuery,
    });
    const list = (matchedChunks || []) as ChunkRow[];
    chunksByQueryIndex[i] = list;
    chunksPerSubquery[i] = list.length;
    for (const c of list) {
      const dist = distanceOf(c);
      const existing = chunkMap.get(c.id);
      if (!existing || distanceOf(existing) > dist) {
        chunkMap.set(c.id, { ...c, distance: dist });
      }
      const prov = provenanceByChunkId.get(c.id) ?? [];
      const provKey = `${slot}\0${query}`;
      if (!prov.some((p) => `${p.slot}\0${p.query}` === provKey)) {
        prov.push({ slot, query });
      }
      provenanceByChunkId.set(c.id, prov);
    }
  }));
  const chunks = capWithFairAllocation(
    chunkMap,
    chunksByQueryIndex,
    MATCH_CHUNKS_MERGED_CAP,
    (c) => c.id,
    distanceOf,
  );
  return { chunks, chunksPerSubquery, provenanceByChunkId };
}