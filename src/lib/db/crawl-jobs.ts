import { supabase } from '@/lib/supabase';
import type { CrawlJob, CrawlJobInsert } from './types';

export const crawlJobsApi = {
  async listBySource(sourceId: string) {
    const { data, error } = await supabase
      .from('crawl_jobs')
      .select('*')
      .eq('source_id', sourceId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data as CrawlJob[];
  },

  async get(id: string) {
    const { data, error } = await supabase
      .from('crawl_jobs')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data as CrawlJob;
  },

  async create(job: CrawlJobInsert) {
    const { data, error } = await supabase
      .from('crawl_jobs')
      .insert(job)
      .select()
      .single();

    if (error) throw error;
    return data as CrawlJob;
  },

  async update(id: string, updates: Partial<CrawlJob>) {
    const { data, error } = await supabase
      .from('crawl_jobs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as CrawlJob;
  },
};


