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
    console.log('[crawl-job] create insert', {
      sourceId: job.source_id?.slice(0, 8),
      conversationId: job.conversation_id?.slice(0, 8),
      status: job.status,
    });
    const { data, error } = await supabase
      .from('crawl_jobs')
      .insert(job)
      .select()
      .single();

    if (error) {
      console.error('[crawl-job] create failed', { error: error.message, code: error.code });
      throw error;
    }
    console.log('[crawl-job] create success', { jobId: (data as CrawlJob).id?.slice(0, 8) });
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


