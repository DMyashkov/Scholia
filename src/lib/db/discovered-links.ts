import { supabase } from '@/lib/supabase';

export const discoveredLinksApi = {
  async countBySource(_conversationId: string, sourceId: string): Promise<number> {
    const { data: pages } = await supabase.from('pages').select('id').eq('source_id', sourceId);
    const pageIds = (pages ?? []).map((p) => p.id);
    if (pageIds.length === 0) return 0;
    const { count, error } = await supabase
      .from('discovered_links')
      .select('*', { count: 'exact', head: true })
      .in('from_page_id', pageIds);
    if (error) return 0;
    return count ?? 0;
  },

  async countEncodedBySource(_conversationId: string, sourceId: string): Promise<number> {
    const { data: pages } = await supabase.from('pages').select('id').eq('source_id', sourceId);
    const pageIds = (pages ?? []).map((p) => p.id);
    if (pageIds.length === 0) return 0;
    const { count, error } = await supabase
      .from('discovered_links')
      .select('*', { count: 'exact', head: true })
      .in('from_page_id', pageIds)
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
    const { data, error } = await supabase
      .from('discovered_links')
      .select('from_page_id')
      .in('from_page_id', pageIds);
    if (error) return {};
    const map: Record<string, number> = {};
    for (const row of data ?? []) {
      const sid = pageToSource.get((row as { from_page_id: string }).from_page_id);
      if (sid) map[sid] = (map[sid] ?? 0) + 1;
    }
    return map;
  },

  /** Count discovered_links with embeddings (encoded) - these can be suggested by RAG */
  async countsEncodedByConversation(conversationId: string): Promise<Record<string, number>> {
    const { data: sources } = await supabase.from('sources').select('id').eq('conversation_id', conversationId);
    const sourceIds = (sources ?? []).map((s) => s.id);
    if (sourceIds.length === 0) return {};
    const { data: pages } = await supabase.from('pages').select('id, source_id').in('source_id', sourceIds);
    const pageToSource = new Map((pages ?? []).map((p) => [p.id, p.source_id]));
    const pageIds = Array.from(pageToSource.keys());
    if (pageIds.length === 0) return {};
    const { data, error } = await supabase
      .from('discovered_links')
      .select('from_page_id')
      .in('from_page_id', pageIds)
      .not('embedding', 'is', null);
    if (error) return {};
    const map: Record<string, number> = {};
    for (const row of data ?? []) {
      const sid = pageToSource.get((row as { from_page_id: string }).from_page_id);
      if (sid) map[sid] = (map[sid] ?? 0) + 1;
    }
    return map;
  },
};
