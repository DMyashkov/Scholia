import { supabase } from '@/lib/supabase';
import type { Page, PageEdge } from './types';


const PAGE_EDGES_CHUNK = 1000;

async function fetchAllPageEdges(pageIds: string[]): Promise<Record<string, unknown>[]> {
  if (pageIds.length === 0) return [];
  const out: Record<string, unknown>[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('page_edges')
      .select('*')
      .in('from_page_id', pageIds)
      .range(offset, offset + PAGE_EDGES_CHUNK - 1);
    if (error) throw error;
    const chunk = data ?? [];
    out.push(...chunk);
    if (chunk.length < PAGE_EDGES_CHUNK) break;
    offset += PAGE_EDGES_CHUNK;
  }
  return out;
}

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
      .eq('status', 'indexed') 
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

    const data = await fetchAllPageEdges(pageIds);
    const pageMap = new Map((pages || []).map((p) => [p.id, p]));
    return data.map((e) => ({
      ...e,
      source_id: pageMap.get(e.from_page_id as string)?.source_id ?? '',
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

    let data: Record<string, unknown>[];
    try {
      data = await fetchAllPageEdges(pageIds);
    } catch (error) {
      const err = error as { message?: string };
      console.error('[page_edges] listByConversation error:', err?.message);
      throw error;
    }
    const pageMap = new Map((pages || []).map((p) => [p.id, p]));
    return data.map((e) => ({
      ...e,
      source_id: pageMap.get(e.from_page_id as string)?.source_id ?? '',
      conversation_id: conversationId,
    })) as PageEdge[];
  },

  /**
   * Edges where both from and to are in pageIds (and to_page_id is set).
   * Small payload for the graph – no need to fetch 20k edges then filter client-side.
   */
  async listGraphEdgesByConversation(conversationId: string, pageIds: string[]): Promise<PageEdge[]> {
    if (pageIds.length === 0) return [];
    const { data, error } = await supabase
      .from('page_edges')
      .select('*')
      .in('from_page_id', pageIds)
      .not('to_page_id', 'is', null)
      .in('to_page_id', pageIds);
    if (error) {
      console.error('[page_edges] listGraphEdgesByConversation error:', error.message);
      throw error;
    }
    const rows = data ?? [];
    if (import.meta.env?.DEV && pageIds.length > 0) {
      const fromIds = new Set(rows.map((r: { from_page_id: string }) => r.from_page_id));
      console.log('[page_edges] listGraphEdgesByConversation', {
        pageIdsCount: pageIds.length,
        edgesReturned: rows.length,
        uniqueFromIds: fromIds.size,
        fromIdSamples: [...fromIds].slice(0, 5).map((id) => id?.slice(0, 8)),
      });
    }
    return rows.map((e: Record<string, unknown>) => ({
      ...e,
      source_id: '',
      conversation_id: conversationId,
    })) as PageEdge[];
  },
};