import { supabase } from '@/lib/supabase';
import type { Source, SourceInsert } from './types';

export const sourcesApi = {
  async list(userId: string | null) {
    const query = supabase
      .from('sources')
      .select('*')
      .order('created_at', { ascending: false });

    if (userId) {
      query.eq('owner_id', userId);
    } else {
      query.is('owner_id', null);
    }

    const { data, error } = await query;
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
    const { data, error } = await supabase
      .from('sources')
      .insert(source)
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


