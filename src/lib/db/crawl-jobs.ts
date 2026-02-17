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

  /** List jobs for sources in a conversation (source_ids imply conversation via sources) */
  async listBySourceAndConversation(sourceIds: string[], _conversationId: string) {
    if (sourceIds.length === 0) return [];
    const { data, error } = await supabase
      .from('crawl_jobs')
      .select('*')
      .in('source_id', sourceIds)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as CrawlJob[]) ?? [];
  },

  /** Latest main crawl job per source (explicit_crawl_urls is null) - for ready/error status, ignores add-page jobs */
  async listLatestMainBySources(sourceIds: string[], _conversationId: string) {
    if (sourceIds.length === 0) return [];
    const { data, error } = await supabase
      .from('crawl_jobs')
      .select('*')
      .in('source_id', sourceIds)
      .is('explicit_crawl_urls', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    const jobs = (data as CrawlJob[]) ?? [];
    // One per source (first/created_at desc = latest per source since we ordered by created_at)
    const bySource = new Map<string, CrawlJob>();
    for (const j of jobs) {
      if (!bySource.has(j.source_id)) bySource.set(j.source_id, j);
    }
    return Array.from(bySource.values());
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

  /** Latest main crawl job (explicit_crawl_urls is null) - used for source ready/error status */
  async getLatestMainBySource(sourceId: string, _conversationId: string) {
    const { data, error } = await supabase
      .from('crawl_jobs')
      .select('*')
      .eq('source_id', sourceId)
      .is('explicit_crawl_urls', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data as CrawlJob | null;
  },

  /** Latest crawl job for a source with explicit_crawl_urls (add-page flow) */
  async getLatestWithExplicitUrlsBySource(_conversationId: string, sourceId: string) {
    const { data, error } = await supabase
      .from('crawl_jobs')
      .select('*')
      .eq('source_id', sourceId)
      .not('explicit_crawl_urls', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data as CrawlJob | null;
  },

  async create(job: CrawlJobInsert) {
    console.log('[crawl-job] create insert', {
      sourceId: job.source_id?.slice(0, 8),
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


