import { supabase } from '@/lib/supabase';
import type { Conversation, ConversationInsert } from './types';

export const conversationsApi = {
  async list(userId: string) {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data as Conversation[];
  },

  async get(id: string) {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data as Conversation;
  },

  async create(conversation: ConversationInsert) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Authentication required');
    const insertData = {
      ...conversation,
      owner_id: user.id,
    };

    const { data, error } = await supabase
      .from('conversations')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('Create conversation error:', error);
      throw error;
    }
    return data as Conversation;
  },

  async update(id: string, updates: Partial<Pick<Conversation, 'title' | 'dynamic_mode'>>) {
    const { data, error } = await supabase
      .from('conversations')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as Conversation;
  },

  async delete(id: string) {
    // First check if conversation exists and get its owner_id for debugging
    const { data: existing, error: fetchError } = await supabase
      .from('conversations')
      .select('id, owner_id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      console.error('Conversation not found:', fetchError);
      throw new Error('Conversation not found');
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Authentication required');

    if (existing.owner_id !== user.id) {
      console.error('Permission denied:', { 
        conversationOwnerId: existing.owner_id, 
        currentUserId 
      });
      throw new Error('You do not have permission to delete this conversation.');
    }

    // Delete the conversation
    const { error, data } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id)
      .select();

    if (error) {
      console.error('Delete conversation error:', error);
      throw error;
    }
    
    // If no rows were deleted, RLS blocked it
    if (!data || data.length === 0) {
      console.error('RLS policy blocked deletion. Conversation owner_id:', existing.owner_id, 'Current user:', user.id);
      throw new Error('Failed to delete conversation. RLS policy may be blocking deletion. Please check your database policies.');
    }
  },

  async deleteAll() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Authentication required');
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('owner_id', user.id);
    if (error) throw error;
  },
};


