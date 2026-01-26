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
    
    // Debug: Only log if there's an issue (no pages when expected)
    if (import.meta.env.DEV && data?.length === 0) {
      const { data: allPages } = await supabase
        .from('pages')
        .select('id, status, conversation_id, owner_id, source_id')
        .eq('conversation_id', conversationId)
        .limit(5);
      
      if (allPages && allPages.length > 0) {
        console.warn(`⚠️ Found ${allPages.length} pages for conversation but none with status='indexed':`, {
          conversationId: conversationId.substring(0, 8) + '...',
          pages: allPages.map(p => ({ status: p.status, source: p.source_id?.substring(0, 8) })),
        });
      } else {
        // Check if pages exist at all
        const { data: anyPages } = await supabase
          .from('pages')
          .select('conversation_id, source_id')
          .limit(3);
        console.warn(`⚠️ No pages found for conversation ${conversationId.substring(0, 8)}...`, {
          totalPagesInDB: anyPages?.length || 0,
          sampleConversationIds: anyPages?.map(p => p.conversation_id?.substring(0, 8) + '...') || [],
          fullConversationId: conversationId,
          sampleFullIds: anyPages?.map(p => p.conversation_id) || [],
        });
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

    if (error) {
      console.error('❌ Error fetching edges by conversation:', error);
      throw error;
    }
    
    // Debug: Log if no edges found
    if (import.meta.env.DEV && data?.length === 0) {
      // Check if edges exist at all for this conversation
      const { data: anyEdges } = await supabase
        .from('page_edges')
        .select('conversation_id, source_id, from_url, to_url')
        .limit(5);
      console.warn(`⚠️ No edges found for conversation ${conversationId.substring(0, 8)}...`, {
        totalEdgesInDB: anyEdges?.length || 0,
        sampleConversationIds: anyEdges?.map(e => e.conversation_id?.substring(0, 8) + '...') || [],
        fullConversationId: conversationId,
        sampleEdges: anyEdges?.slice(0, 2).map(e => ({
          conversation_id: e.conversation_id?.substring(0, 8),
          from: e.from_url?.substring(0, 40),
          to: e.to_url?.substring(0, 40),
        })) || [],
      });
    }
    
    return (data || []) as PageEdge[];
  },
};


