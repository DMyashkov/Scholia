import { supabase } from '@/lib/supabase';
import type { Page, PageEdge } from './types';

export const pagesApi = {
  async listBySource(sourceId: string) {
    const { data, error } = await supabase
      .from('pages')
      .select('*')
      .eq('source_id', sourceId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data as Page[];
  },

  async listByConversation(conversationId: string) {
    // Get source_ids for conversation, then filter pages by source_id
    const { data: sources } = await supabase
      .from('sources')
      .select('id')
      .eq('conversation_id', conversationId);
    const sourceIds = (sources ?? []).map((s) => s.id);
    if (sourceIds.length === 0) return [] as Page[];

    const { data, error } = await supabase
      .from('pages')
      .select('*')
      .in('source_id', sourceIds)
      .eq('status', 'indexed') // Only show indexed pages, not discovered ones
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[pages] listByConversation error:', error.message);
      throw error;
    }
    return data as Page[];
  },

  async get(id: string) {
    const { data, error } = await supabase
      .from('pages')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data as Page;
  },
};

export const pageEdgesApi = {
  async listBySource(sourceId: string) {
    const { data: pages } = await supabase.from('pages').select('id, source_id').eq('source_id', sourceId);
    const { data: sourceRow } = await supabase.from('sources').select('conversation_id').eq('id', sourceId).single();
    const conversationId = (sourceRow as { conversation_id?: string } | null)?.conversation_id ?? '';
    const pageIds = (pages || []).map((p) => p.id);
    if (pageIds.length === 0) return [];

    const { data, error } = await supabase
      .from('page_edges')
      .select('*')
      .in('from_page_id', pageIds);

    if (error) throw error;
    const pageMap = new Map((pages || []).map((p) => [p.id, p]));
    return (data || []).map((e) => ({
      ...e,
      source_id: pageMap.get(e.from_page_id)?.source_id ?? '',
      conversation_id: conversationId,
    })) as PageEdge[];
  },

  async listByConversation(conversationId: string) {
    const { data: sources } = await supabase.from('sources').select('id').eq('conversation_id', conversationId);
    const sourceIds = (sources ?? []).map((s) => s.id);
    if (sourceIds.length === 0) return [];

    const { data: pages } = await supabase.from('pages').select('id, source_id').in('source_id', sourceIds);
    const pageIds = (pages || []).map((p) => p.id);
    if (pageIds.length === 0) return [];

    const { data, error } = await supabase
      .from('page_edges')
      .select('*')
      .in('from_page_id', pageIds);

    if (error) {
      console.error('[page_edges] listByConversation error:', error.message);
      throw error;
    }
    const pageMap = new Map((pages || []).map((p) => [p.id, p]));
    return (data || []).map((e) => ({
      ...e,
      source_id: pageMap.get(e.from_page_id)?.source_id ?? '',
      conversation_id: conversationId,
    })) as PageEdge[];
  },
};


