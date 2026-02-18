import { supabase } from '@/lib/supabase';

export const discoveredLinksApi = {
  async countBySource(_conversationId: string, sourceId: string): Promise<number> {
    const { data: pages } = await supabase.from('pages').select('id').eq('source_id', sourceId);
    const pageIds = (pages ?? []).map((p) => p.id);
    if (pageIds.length === 0) return 0;
    const { data: edges } = await supabase.from('page_edges').select('id').in('from_page_id', pageIds);
    const edgeIds = (edges ?? []).map((e) => e.id);
    if (edgeIds.length === 0) return 0;
    const { count, error } = await supabase
      .from('encoded_discovered')
      .select('*', { count: 'exact', head: true })
      .in('page_edge_id', edgeIds);
    if (error) return 0;
    return count ?? 0;
  },

  async countEncodedBySource(_conversationId: string, sourceId: string): Promise<number> {
    const { data: pages } = await supabase.from('pages').select('id').eq('source_id', sourceId);
    const pageIds = (pages ?? []).map((p) => p.id);
    if (pageIds.length === 0) return 0;
    const { data: edges } = await supabase.from('page_edges').select('id').in('from_page_id', pageIds);
    const edgeIds = (edges ?? []).map((e) => e.id);
    if (edgeIds.length === 0) return 0;
    const { count, error } = await supabase
      .from('encoded_discovered')
      .select('*', { count: 'exact', head: true })
      .in('page_edge_id', edgeIds)
      .not('embedding', 'is', null);
    if (error) return 0;
    return count ?? 0;
  },

  async countsByConversation(conversationId: string): Promise<Record<string, number>> {
    const { data: sources } = await supabase.from('sources').select('id').eq('conversation_id', conversationId);
    const sourceIds = (sources ?? []).map((s) => s.id);
    if (sourceIds.length === 0) return {};
    const { data: pages } = await supabase.from('pages').select('id, source_id').in('source_id', sourceIds);
    const pageToSource = new Map((pages ?? []).map((p) => [p.id, p.source_id]));
    const pageIds = Array.from(pageToSource.keys());
    if (pageIds.length === 0) return {};
    const { data: edges } = await supabase.from('page_edges').select('id, from_page_id').in('from_page_id', pageIds);
    if (!edges?.length) return {};
    const map: Record<string, number> = {};
    const edgeIds = edges.map((e) => e.id);
    const { data: encoded } = await supabase.from('encoded_discovered').select('page_edge_id').in('page_edge_id', edgeIds);
    for (const row of encoded ?? []) {
      const edge = edges.find((e) => e.id === (row as { page_edge_id: string }).page_edge_id);
      const sid = edge ? pageToSource.get(edge.from_page_id) : undefined;
      if (sid) map[sid] = (map[sid] ?? 0) + 1;
    }
    return map;
  },

  /** Count encoded_discovered with embeddings - these can be suggested by RAG */
  async countsEncodedByConversation(conversationId: string): Promise<Record<string, number>> {
    const { data: sources } = await supabase.from('sources').select('id').eq('conversation_id', conversationId);
    const sourceIds = (sources ?? []).map((s) => s.id);
    if (sourceIds.length === 0) return {};
    const { data: pages } = await supabase.from('pages').select('id, source_id').in('source_id', sourceIds);
    const pageToSource = new Map((pages ?? []).map((p) => [p.id, p.source_id]));
    const pageIds = Array.from(pageToSource.keys());
    if (pageIds.length === 0) return {};
    const { data: edges } = await supabase.from('page_edges').select('id, from_page_id').in('from_page_id', pageIds);
    if (!edges?.length) return {};
    const edgeIds = edges.map((e) => e.id);
    const { data: encoded } = await supabase
      .from('encoded_discovered')
      .select('page_edge_id')
      .in('page_edge_id', edgeIds)
      .not('embedding', 'is', null);
    const map: Record<string, number> = {};
    for (const row of encoded ?? []) {
      const edge = edges.find((e) => e.id === (row as { page_edge_id: string }).page_edge_id);
      const sid = edge ? pageToSource.get(edge.from_page_id) : undefined;
      if (sid) map[sid] = (map[sid] ?? 0) + 1;
    }
    return map;
  },
};
