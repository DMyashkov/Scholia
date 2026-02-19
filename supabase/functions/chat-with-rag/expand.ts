import type { SupabaseClient } from '@supabase/supabase-js';
import { embedBatch } from './embed.ts';
import { deriveTitleFromUrl } from './utils.ts';

export type SuggestedPage = {
  url: string;
  title: string;
  snippet: string;
  sourceId: string;
  promptedByQuestion?: string;
  fromPageTitle?: string;
};

/**
 * When action is expand_corpus: get top non-indexed URL via match_discovered_links.
 * Used for terminal expand_corpus — returns a suggested page for the user to add (dynamic sources).
 */
export async function doExpandCorpus(
  supabase: SupabaseClient,
  openaiKey: string,
  sourceIds: string[],
  userMessage: string,
  queryStrings: string[] = [],
): Promise<SuggestedPage | null> {
  if (sourceIds.length === 0) return null;
  const queries = queryStrings.length > 0 ? queryStrings.slice(0, 4) : [userMessage.trim().slice(0, 300)];
  const queryEmbs = await embedBatch(openaiKey, queries);
  const matchMap = new Map<
    string,
    { m: { to_url: string; anchor_text: string | null; snippet: string; source_id: string; from_page_id: string | null }; distance: number }
  >();
  for (let i = 0; i < queryEmbs.length; i++) {
    const { data: matches, error: rpcErr } = await supabase.rpc('match_discovered_links', {
      query_embedding: queryEmbs[i],
      match_source_ids: sourceIds,
      match_count: 12,
    });
    if (rpcErr) {
      console.warn('[expand_corpus] match_discovered_links error:', rpcErr.message);
      continue;
    }
    const list = (matches || []) as {
      to_url: string;
      anchor_text: string | null;
      snippet: string;
      source_id: string;
      from_page_id: string | null;
      distance: number;
    }[];
    for (const m of list) {
      const key = `${m.source_id}:${m.to_url}`;
      const dist = m.distance ?? 1;
      const existing = matchMap.get(key);
      if (!existing || existing.distance > dist) {
        matchMap.set(key, { m, distance: dist });
      }
    }
  }
  const sorted = Array.from(matchMap.values()).sort((a, b) => a.distance - b.distance);
  const top = sorted[0]?.m;
  if (!top) return null;

  let fromPageTitle: string | undefined;
  if (top.from_page_id) {
    const { data: fromPage } = await supabase.from('pages').select('title').eq('id', top.from_page_id).single();
    fromPageTitle = (fromPage as { title: string | null } | null)?.title ?? undefined;
  }

  return {
    url: top.to_url,
    title: top.anchor_text?.trim() || deriveTitleFromUrl(top.to_url),
    snippet: top.snippet,
    sourceId: top.source_id,
    promptedByQuestion: userMessage.trim() || undefined,
    fromPageTitle,
  };
}
