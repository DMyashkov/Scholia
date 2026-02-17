import { supabase } from '@/lib/supabase';
import type { AddPageJob } from './types';

export const addPageJobsApi = {
  async getById(jobId: string): Promise<AddPageJob | null> {
    const { data, error } = await supabase
      .from('add_page_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();
    if (error) throw error;
    return data as AddPageJob | null;
  },
  async getLatestBySource(conversationId: string, sourceId: string): Promise<AddPageJob | null> {
    const { data, error } = await supabase
      .from('add_page_jobs')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('source_id', sourceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data as AddPageJob | null;
  },
};
