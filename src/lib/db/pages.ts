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
      console.error('❌ Error fetching pages by conversation:', error);
      throw error;
    }
    
    // Debug: Also check all pages (any status) for this conversation
    if (import.meta.env.DEV) {
      const { data: allPages } = await supabase
        .from('pages')
        .select('id, status, conversation_id')
        .eq('conversation_id', conversationId);
      console.log(`📄 Fetched ${data?.length || 0} indexed pages for conversation ${conversationId}`);
      console.log(`📄 Total pages (any status) for conversation ${conversationId}: ${allPages?.length || 0}`);
      if (allPages && allPages.length > 0) {
        const statusCounts = allPages.reduce((acc: Record<string, number>, p: any) => {
          acc[p.status] = (acc[p.status] || 0) + 1;
          return acc;
        }, {});
        console.log(`📄 Status breakdown:`, statusCounts);
      }
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
    // Filter by conversation_id directly
    const { data, error } = await supabase
      .from('page_edges')
      .select('*')
      .eq('conversation_id', conversationId);

    if (error) throw error;
    return data as PageEdge[];
  },
};


