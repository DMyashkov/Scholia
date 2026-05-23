import type { SupabaseClient } from '@supabase/supabase-js';
import { embedBatch } from './embed.ts';
import { deriveTitleFromUrl } from './utils.ts';
import {
  SUGGESTION_MATCH_COUNT_MAX,
  SUGGESTION_MATCH_COUNT_MIN,
} from './config.ts';

export type SuggestedPage = {
  url: string;
  title: string;
  snippet: string;
  sourceId: string;
  promptedByQuestion?: string;
  fromPageTitle?: string;
};

type MatchRow = {
  to_url: string;
  anchor_text: string | null;
  snippet: string;
  source_id: string;
  from_page_id: string | null;
  distance: number;
};

export function perRpcMatchCount(limit: number, queryCount: number): number {
  if (queryCount <= 0) return Math.min(SUGGESTION_MATCH_COUNT_MAX, Math.max(SUGGESTION_MATCH_COUNT_MIN, limit));
  const raw = Math.ceil(limit / queryCount) + 1;
  return Math.min(SUGGESTION_MATCH_COUNT_MAX, Math.max(SUGGESTION_MATCH_COUNT_MIN, raw));
}

export async function getTopSuggestedPages(
  supabase: SupabaseClient,
  openaiKey: string,
  sourceIds: string[],
  userMessage: string,
  queryStrings: string[] = [],
  limit = 10,
): Promise<SuggestedPage[]> {
  if (sourceIds.length === 0) return [];

  const queries =
    queryStrings.length > 0
      ? queryStrings.map((q) => q.trim()).filter((q) => q.length > 0)
      : [userMessage.trim().slice(0, 300)].filter((q) => q.length > 0);
  if (queries.length === 0) return [];

  const perRpc = perRpcMatchCount(limit, queries.length);
  const queryEmbs = await embedBatch(openaiKey, queries);
  const matchMap = new Map<string, { m: MatchRow; distance: number }>();

  for (let i = 0; i < queryEmbs.length; i++) {
    const { data: matches, error: rpcErr } = await supabase.rpc('match_discovered_links', {
      query_embedding: queryEmbs[i],
      match_source_ids: sourceIds,
      match_count: perRpc,
    });
    if (rpcErr) {
      console.warn('[expand_corpus] match_discovered_links error:', rpcErr.message);
      continue;
    }
    const list = (matches || []) as MatchRow[];
    for (const m of list) {
      const dist = m.distance ?? 1;
      const key = `${m.source_id}:${m.to_url}`;
      const existing = matchMap.get(key);
      if (!existing || existing.distance > dist) {
        matchMap.set(key, { m, distance: dist });
      }
    }
  }

  const topMatchRows = Array.from(matchMap.values())
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((x) => x.m);

  if (topMatchRows.length === 0) return [];

  const fromPageIds = [...new Set(topMatchRows.map((m) => m.from_page_id).filter(Boolean))] as string[];
  const { data: fromPages } = fromPageIds.length > 0
    ? await supabase.from('pages').select('id, title').in('id', fromPageIds)
    : { data: [] as { id: string; title: string | null }[] };
  const titleByPageId = new Map(
    ((fromPages ?? []) as { id: string; title: string | null }[]).map((p) => [p.id, p.title ?? null]),
  );

  return topMatchRows.map((m) => ({
    url: m.to_url,
    title: m.anchor_text?.trim() || deriveTitleFromUrl(m.to_url),
    snippet: m.snippet,
    sourceId: m.source_id,
    promptedByQuestion: userMessage.trim() || undefined,
    fromPageTitle: (m.from_page_id ? titleByPageId.get(m.from_page_id) : null) ?? undefined,
  }));
}

export async function doExpandCorpus(
  supabase: SupabaseClient,
  openaiKey: string,
  sourceIds: string[],
  userMessage: string,
  queryStrings: string[] = [],
): Promise<SuggestedPage | null> {
  const list = await getTopSuggestedPages(supabase, openaiKey, sourceIds, userMessage, queryStrings, 1);
  return list[0] ?? null;
}
