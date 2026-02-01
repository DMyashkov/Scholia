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
    // Filter by conversation_id directly and only show indexed pages
    const { data, error } = await supabase
      .from('pages')
      .select('*')
      .eq('conversation_id', conversationId)
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
    const { data, error } = await supabase
      .from('page_edges')
      .select('*')
      .eq('source_id', sourceId);

    if (error) throw error;
    return data as PageEdge[];
  },

  async listByConversation(conversationId: string) {
    const { data, error } = await supabase
      .from('page_edges')
      .select('*')
      .eq('conversation_id', conversationId);

    if (error) {
      console.error('[page_edges] listByConversation error:', error.message);
      throw error;
    }
    if (import.meta.env.DEV && (data?.length ?? 0) > 0) {
      console.log('[page_edges] listByConversation ok', { count: data?.length, conversationId: conversationId.slice(0, 8) });
    }
    return (data || []) as PageEdge[];
  },
};


