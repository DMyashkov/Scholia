import { supabase } from '@/lib/supabase';
import type { Message, MessageInsert } from './types';

export const messagesApi = {
  async list(conversationId: string) {
    const { data, error } = await supabase
      .from('messages')
      .select('*, quotes(*, pages!quotes_page_id_fkey(source_id))')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .order('citation_order', { foreignTable: 'quotes', ascending: true, nullsFirst: false });

    if (error) throw error;
    return (data ?? []) as (Message & { quotes: Array<Record<string, unknown>> })[];
  },

  async create(message: MessageInsert) {
    const { data, error } = await supabase
      .from('messages')
      .insert(message)
      .select()
      .single();

    if (error) throw error;
    return data as Message;
  },

  async update(id: string, updates: Record<string, unknown>) {
    const { data, error } = await supabase
      .from('messages')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as Message;
  },

  async delete(id: string) {
    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  async deleteFrom(conversationId: string, messageId: string) {
    const { data: allMsgs, error: listErr } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (listErr) throw listErr;
    const rows = (allMsgs ?? []) as { id: string }[];
    const pivotIdx = rows.findIndex((r) => r.id === messageId);
    if (pivotIdx === -1) return;
    const ids = rows.slice(pivotIdx).map((r) => r.id);
    const { error } = await supabase
      .from('messages')
      .delete()
      .in('id', ids);
    if (error) throw error;
  },
};