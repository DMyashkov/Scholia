import { supabase } from '@/lib/supabase';
import type { Source, SourceInsert } from './types';

export const sourcesApi = {
  async listByConversation(conversationId: string) {
    const { data, error } = await supabase
      .from('sources')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data as Source[];
  },

  async get(id: string) {
    const { data, error } = await supabase
      .from('sources')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data as Source;
  },

  async create(source: SourceInsert & { conversation_id: string }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Authentication required');
    const insertData = { ...source, owner_id: user.id };
    const { data, error } = await supabase
      .from('sources')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    return data as Source;
  },

  async update(id: string, updates: Partial<Source>) {
    const { data, error } = await supabase
      .from('sources')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as Source;
  },

  async delete(id: string) {
    const { error } = await supabase.from('sources').delete().eq('id', id);
    if (error) throw error;
  },

  /** Find conversations that have a source with this URL (excluding optional conversation) */
  async findConversationsWithUrl(url: string, excludeConversationId?: string) {
    let query = supabase
      .from('sources')
      .select('conversation_id, conversation:conversations(id, title, created_at)')
      .eq('initial_url', url);
    if (excludeConversationId) {
      query = query.neq('conversation_id', excludeConversationId);
    }
    const { data, error } = await query;
    if (error) throw error;
    type Row = { conversation_id: string; conversation: { id: string; title: string | null; created_at: string } | null };
    return ((data || []) as Row[]).map((item) => ({
      conversationId: item.conversation_id,
      conversation: item.conversation,
    }));
  },
};


