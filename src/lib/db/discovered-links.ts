import { supabase } from '@/lib/supabase';

/** Only query encoded_discovered for sources with crawl_depth = 'dynamic'. */
async function getDynamicSourceIds(conversationId: string): Promise<string[]> {
  const { data: sources } = await supabase
    .from('sources')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('crawl_depth', 'dynamic');
  return (sources ?? []).map((s) => s.id);
}

export const discoveredLinksApi = {
  async countBySource(_conversationId: string, sourceId: string): Promise<number> {
    const { data: source } = await supabase.from('sources').select('crawl_depth').eq('id', sourceId).single();
    if (source?.crawl_depth !== 'dynamic') return 0;
    const { data: pages } = await supabase.from('pages').select('id').eq('source_id', sourceId);
    const pageIds = (pages ?? []).map((p) => p.id);
    if (pageIds.length === 0) return 0;
    const { data: edges } = await supabase.from('page_edges').select('id').in('from_page_id', pageIds);
    const edgeIds = (edges ?? []).map((e) => e.id);
    if (edgeIds.length === 0) return 0;
    const { data: count, error } = await supabase.rpc('count_encoded_discovered_by_edge_ids', { edge_ids: edgeIds });
    if (error) return 0;
    return Number(count ?? 0);
  },

  async countEncodedBySource(_conversationId: string, sourceId: string): Promise<number> {
    const { data: source } = await supabase.from('sources').select('crawl_depth').eq('id', sourceId).single();
    if (source?.crawl_depth !== 'dynamic') return 0;
    const { data: pages } = await supabase.from('pages').select('id').eq('source_id', sourceId);
    const pageIds = (pages ?? []).map((p) => p.id);
    if (pageIds.length === 0) return 0;
    const { data: edges } = await supabase.from('page_edges').select('id').in('from_page_id', pageIds);
    const edgeIds = (edges ?? []).map((e) => e.id);
    if (edgeIds.length === 0) return 0;
    const { data: count, error } = await supabase.rpc('count_encoded_discovered_with_embedding_by_edge_ids', {
      edge_ids: edgeIds,
    });
    if (error) return 0;
    return Number(count ?? 0);
  },

  async countsByConversation(conversationId: string): Promise<Record<string, number>> {
    const dynamicSourceIds = await getDynamicSourceIds(conversationId);
    if (dynamicSourceIds.length === 0) return {};
    const { data: pages } = await supabase
      .from('pages')
      .select('id, source_id')
      .in('source_id', dynamicSourceIds);
    const pageToSource = new Map((pages ?? []).map((p) => [p.id, p.source_id]));
    const pageIds = Array.from(pageToSource.keys());
    if (pageIds.length === 0) return {};
    const { data: edges } = await supabase.from('page_edges').select('id, from_page_id').in('from_page_id', pageIds);
    if (!edges?.length) return {};
    const edgeIds = edges.map((e) => e.id);
    const { data: encoded, error } = await supabase.rpc('get_encoded_discovered_page_edge_ids', {
      edge_ids: edgeIds,
    });
    if (error) return {};
    const map: Record<string, number> = {};
    for (const row of encoded ?? []) {
      const edge = edges.find((e) => e.id === (row as { page_edge_id: string }).page_edge_id);
      const sid = edge ? pageToSource.get(edge.from_page_id) : undefined;
      if (sid) map[sid] = (map[sid] ?? 0) + 1;
    }
    return map;
  },

  /** Count encoded_discovered with embeddings - these can be suggested by RAG. Only for dynamic sources. */
  async countsEncodedByConversation(conversationId: string): Promise<Record<string, number>> {
    const dynamicSourceIds = await getDynamicSourceIds(conversationId);
    if (dynamicSourceIds.length === 0) return {};
    const { data: pages } = await supabase
      .from('pages')
      .select('id, source_id')
      .in('source_id', dynamicSourceIds);
    const pageToSource = new Map((pages ?? []).map((p) => [p.id, p.source_id]));
    const pageIds = Array.from(pageToSource.keys());
    if (pageIds.length === 0) return {};
    const { data: edges } = await supabase.from('page_edges').select('id, from_page_id').in('from_page_id', pageIds);
    if (!edges?.length) return {};
    const edgeIds = edges.map((e) => e.id);
    const { data: encoded, error } = await supabase.rpc('get_encoded_discovered_with_embedding_page_edge_ids', {
      edge_ids: edgeIds,
    });
    if (error) return {};
    const map: Record<string, number> = {};
    for (const row of encoded ?? []) {
      const edge = edges.find((e) => e.id === (row as { page_edge_id }).page_edge_id);
      const sid = edge ? pageToSource.get(edge.from_page_id) : undefined;
      if (sid) map[sid] = (map[sid] ?? 0) + 1;
    }
    return map;
  },
};
