import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChunkRow } from './types.ts';
import type { PageRow } from './types.ts';
import { embedBatch } from './embed.ts';
import { MATCH_CHUNKS_PER_QUERY } from './config.ts';
import { MATCH_CHUNKS_MERGED_CAP } from './config.ts';
import { createQuoteFromChunk } from './quotes.ts';

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

export interface RetrievedWithQuotes {
  chunks: ChunkRow[];
  quoteIds: string[];
}

/**
 * Run retrieval and create one quote per chunk for the given reasoning step.
 * pageById must contain all pages for chunk.page_id; domain can be derived from page.url or a source map.
 */
export async function doRetrieveAndCreateQuotes(
  supabase: SupabaseClient,
  openaiKey: string,
  pageIds: string[],
  queries: string[],
  pageById: Map<string, PageRow>,
  sourceDomainByPageId: Map<string, string>,
  reasoningStepId: string,
  ownerId: string,
  perQuery = MATCH_CHUNKS_PER_QUERY,
): Promise<RetrievedWithQuotes & { chunksPerSubquery: number[] }> {
  const { chunks, chunksPerSubquery } = await doRetrieve(supabase, openaiKey, pageIds, queries, perQuery);
  const quoteIds: string[] = [];
  for (const chunk of chunks) {
    const page = pageById.get(chunk.page_id);
    if (!page) continue;
    let domain = sourceDomainByPageId.get(chunk.page_id) ?? '';
    if (!domain && page.url) {
      try {
        domain = new URL(page.url).hostname;
      } catch {
        domain = '';
      }
    }
    const id = await createQuoteFromChunk(supabase, {
      chunk,
      page,
      domain,
      retrievedInReasoningStepId: reasoningStepId,
      ownerId,
    });
    if (id) quoteIds.push(id);
  }
  return { chunks, quoteIds, chunksPerSubquery };
}
