import type { SupabaseClient } from '@supabase/supabase-js';
import { embedBatch } from './embed.ts';
import { deriveTitleFromUrl, extractQueryTerms, partitionByTermMatch } from './utils.ts';

export type SuggestedPage = {
  url: string;
  title: string;
  snippet: string;
  sourceId: string;
  promptedByQuestion?: string;
  fromPageTitle?: string;
  unfoldMode?: 'unfold' | 'direct' | 'auto';
};

export async function trySuggestPage(
  supabase: SupabaseClient,
  openaiKey: string,
  conversationId: string,
  userMessage: string,
  searchQueries: string[],
  allSourceIds: string[],
  unfoldMode: 'auto' | 'unfold' | 'direct',
): Promise<SuggestedPage | null> {
  const suggestionQueries = [
    ...searchQueries.slice(0, 3),
    ...(searchQueries.some((q) => q.toLowerCase().includes(userMessage.trim().toLowerCase().slice(0, 30))) ? [] : [userMessage.trim()]),
  ];
  const uniqueQueries = [...new Set(suggestionQueries)].slice(0, 4);
  const queryEmbs = await embedBatch(openaiKey, uniqueQueries);

  const matchMap = new Map<string, { m: { to_url: string; anchor_text: string | null; snippet: string; source_id: string; from_page_id: string | null }; distance: number }>();
  for (let i = 0; i < queryEmbs.length; i++) {
    const { data: matches, error: rpcErr } = await supabase.rpc('match_discovered_links', {
      query_embedding: queryEmbs[i],
      match_source_ids: allSourceIds,
      match_count: 12,
    });
    if (rpcErr) {
      console.log('[RAG-SUGGEST] match_discovered_links RPC error:', rpcErr.message, '| queryIndex:', i);
    }
    const list = (matches || []) as { to_url: string; anchor_text: string | null; snippet: string; source_id: string; from_page_id: string | null; distance: number }[];
    if (list.length === 0 && i === 0) {
      console.log('[RAG-SUGGEST] match_discovered_links returned 0 rows for first query | sourceIds:', allSourceIds.length);
    }
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
  let list = sorted.map((x) => x.m);

  const terms = extractQueryTerms(userMessage.trim());
  if (terms.length > 0) {
    const { withMatch, withoutMatch } = partitionByTermMatch(list, terms);
    list = [...withMatch, ...withoutMatch];
  }

  const top = list[0];
  if (!top) {
    console.log('[RAG-SUGGEST] no suggested page: match_discovered_links returned no non-indexed candidates');
    return null;
  }

  let fromPageTitle: string | undefined;
  if (top.from_page_id) {
    const { data: fromPage } = await supabase.from('pages').select('title').eq('id', top.from_page_id).single();
    fromPageTitle = (fromPage as { title: string | null } | null)?.title ?? undefined;
  }

  console.log('[RAG-SUGGEST] suggested page set:', top.to_url);
  return {
    url: top.to_url,
    title: top.anchor_text?.trim() || deriveTitleFromUrl(top.to_url),
    snippet: top.snippet,
    sourceId: top.source_id,
    promptedByQuestion: userMessage.trim(),
    fromPageTitle,
    unfoldMode: unfoldMode === 'unfold' || unfoldMode === 'direct' ? unfoldMode : 'auto',
  };
}
