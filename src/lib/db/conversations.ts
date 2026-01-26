import { supabase } from '@/lib/supabase';
import type { Conversation, ConversationInsert } from './types';

export const conversationsApi = {
  async list(userId: string | null) {
    const query = supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false });

    if (userId) {
      query.eq('owner_id', userId);
    } else {
      query.is('owner_id', null);
    }

    const { data, error } = await query;
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
    // Get current user to set owner_id explicitly
    const { data: { user } } = await supabase.auth.getUser();
    const insertData = {
      ...conversation,
      owner_id: user?.id || null,
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

  async update(id: string, updates: Partial<Pick<Conversation, 'title'>>) {
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

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    const currentUserId = user?.id || null;

    // Check if user has permission
    if (existing.owner_id !== currentUserId && existing.owner_id !== null) {
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
      console.error('RLS policy blocked deletion. Conversation owner_id:', existing.owner_id, 'Current user:', currentUserId);
      throw new Error('Failed to delete conversation. RLS policy may be blocking deletion. Please check your database policies.');
    }
  },
};


