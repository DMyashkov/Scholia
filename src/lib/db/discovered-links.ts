import { supabase } from '@/lib/supabase';

export const discoveredLinksApi = {
  async countBySource(conversationId: string, sourceId: string): Promise<number> {
    const { count, error } = await supabase
      .from('discovered_links')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('source_id', sourceId);
    if (error) return 0;
    return count ?? 0;
  },

  async countsByConversation(conversationId: string): Promise<Record<string, number>> {
    const { data, error } = await supabase
      .from('discovered_links')
      .select('source_id')
      .eq('conversation_id', conversationId);
    if (error) return {};
    const map: Record<string, number> = {};
    for (const row of data ?? []) {
      const sid = (row as { source_id: string }).source_id;
      map[sid] = (map[sid] ?? 0) + 1;
    }
    return map;
  },
};
