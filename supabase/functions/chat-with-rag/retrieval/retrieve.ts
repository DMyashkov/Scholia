import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChunkRow, EvidenceChunkProvenance } from '../types.ts';
import { embedBatch } from './embed.ts';
import { MATCH_CHUNKS_PER_QUERY, MATCH_CHUNKS_MERGED_CAP } from '../config.ts';
import { capWithFairAllocation } from '../utils.ts';

export type RetrieveSubquery = { slot: string; query: string };

export interface RetrieveResult {
  chunks: ChunkRow[];
  chunksPerSubquery: number[];
  provenanceByChunkId: Map<string, EvidenceChunkProvenance[]>;
}

/** Returns true for chunks that are indexing noise — CSS blobs, nav fragments, etc. */
function isNoiseChunk(content: string): boolean {
  const t = content.trim();
  // CSS selector blobs: high density of { } and . or # without prose words
  const cssBraceRatio = (t.match(/[{}]/g)?.length ?? 0) / Math.max(t.length, 1);
  if (cssBraceRatio > 0.03) return true;
  // Starts with a CSS selector pattern
  if (/^\s*\.[\w-]+[\s,{]/.test(t)) return true;
  return false;
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
  excludeChunksBySlot?: Map<string, Set<string>>,
): Promise<RetrieveResult> {
  const queries = subqueries.map((s) => s.query);
  const embeddings = await embedBatch(openaiKey, queries);
  const chunkMap = new Map<string, ChunkRow>();
  const chunksByQueryIndex: ChunkRow[][] = new Array(embeddings.length).fill(null);
  const chunksPerSubquery: number[] = new Array(embeddings.length).fill(0);
  const provenanceByChunkId = new Map<string, EvidenceChunkProvenance[]>();

  await Promise.all(embeddings.map(async (embedding, i) => {
    const { slot, query } = subqueries[i];
    const excluded = excludeChunksBySlot?.get(slot);
    const fetchCount = excluded && excluded.size > 0
      ? Math.min(perQuery + excluded.size, perQuery * 3)
      : perQuery;
    const { data: matchedChunks } = await supabase.rpc('match_chunks', {
      query_embedding: embedding,
      match_page_ids: pageIds,
      match_count: fetchCount,
    });
    const rawList = ((matchedChunks || []) as ChunkRow[])
      .filter((c) => !isNoiseChunk(c.content));
    const list = excluded && excluded.size > 0
      ? rawList.filter((c) => !excluded.has(c.id)).slice(0, perQuery)
      : rawList;
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

export interface ListNeighborResult {
  id: string;
  pageId: string;
  content: string;
  pageUrl?: string;
  pageTitle?: string;
  slotName: string;
}

export async function fetchListSlotNeighborChunks(
  supabase: SupabaseClient,
  listSlotChunkIds: string[],
  anchorMeta: Map<string, { pageId: string; pageUrl?: string; pageTitle?: string; slotName: string }>,
  windowChars: number,
  maxPerAnchor: number,
  excludeIds: Set<string>,
): Promise<ListNeighborResult[]> {
  if (listSlotChunkIds.length === 0) return [];

  type PosRow = { id: string; page_id: string; start_index: number | null; end_index: number | null };
  const { data: posRows } = await supabase
    .from('chunks')
    .select('id, page_id, start_index, end_index')
    .in('id', listSlotChunkIds);

  const anchors = ((posRows ?? []) as PosRow[]).filter(
    (a): a is PosRow & { start_index: number; end_index: number } =>
      a.start_index != null && a.end_index != null,
  );
  if (anchors.length === 0) return [];

  const anchorsByPage = new Map<string, typeof anchors>();
  for (const a of anchors) {
    const arr = anchorsByPage.get(a.page_id) ?? [];
    arr.push(a);
    anchorsByPage.set(a.page_id, arr);
  }

  const results: ListNeighborResult[] = [];
  const added = new Set(excludeIds);

  for (const [pageId, pageAnchors] of anchorsByPage.entries()) {
    const rangeStart = Math.min(...pageAnchors.map((a) => a.start_index - windowChars));
    const rangeEnd = Math.max(...pageAnchors.map((a) => a.end_index + windowChars));
    const anchorIdSet = new Set(pageAnchors.map((a) => a.id));
    const perPageLimit = maxPerAnchor * pageAnchors.length;

    const sampleMeta = anchorMeta.get(pageAnchors[0].id);
    const pageUrl = sampleMeta?.pageUrl;
    const pageTitle = sampleMeta?.pageTitle;
    const slotName = sampleMeta?.slotName ?? '';

    type NeighborRow = { id: string; page_id: string; content: string };
    const { data: neighborRows } = await supabase
      .from('chunks')
      .select('id, page_id, content')
      .eq('page_id', pageId)
      .lte('start_index', rangeEnd)
      .gte('end_index', rangeStart)
      .limit(perPageLimit + 20);

    let count = 0;
    for (const row of ((neighborRows ?? []) as NeighborRow[])) {
      if (count >= perPageLimit) break;
      if (anchorIdSet.has(row.id) || added.has(row.id)) continue;
      results.push({ id: row.id, pageId: row.page_id, content: row.content, pageUrl, pageTitle, slotName });
      added.add(row.id);
      count++;
    }
  }

  return results;
}