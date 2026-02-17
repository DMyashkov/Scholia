import { supabase } from '@/lib/supabase';
import type { Message, MessageInsert } from './types';

export const messagesApi = {
  async list(conversationId: string) {
    const { data, error } = await supabase
      .from('messages')
      .select('*, quotes(*, pages!quotes_page_id_fkey(source_id))')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

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
};


