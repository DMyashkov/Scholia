import { supabase } from '@/lib/supabase';
import type { Source, SourceInsert } from './types';

export const sourcesApi = {
  async list(userId: string) {
    const { data, error } = await supabase
      .from('sources')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });
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

  async create(source: SourceInsert) {
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
    const { error } = await supabase
      .from('sources')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },
};


