import { supabase } from '@/lib/supabase';
import type { ConversationSource, Source } from './types';
import { crawlJobsApi } from './crawl-jobs';

export const conversationSourcesApi = {
  async list(conversationId: string) {
    const { data, error } = await supabase
      .from('conversation_sources')
      .select(`
        *,
        source:sources(*)
      `)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data as Array<ConversationSource & { source: Source }>;
  },

  /**
   * Find conversations that already have a source with the given URL
   */
  async findConversationsWithSourceUrl(sourceUrl: string, excludeConversationId?: string) {
    // First find the source by URL
    const { data: sources, error: sourcesError } = await supabase
      .from('sources')
      .select('id')
      .eq('url', sourceUrl)
      .limit(1);

    if (sourcesError || !sources || sources.length === 0) {
      return [];
    }

    const sourceId = sources[0].id;

    // Find conversations that have this source
    let query = supabase
      .from('conversation_sources')
      .select(`
        conversation_id,
        conversation:conversations(id, title, created_at)
      `)
      .eq('source_id', sourceId);

    if (excludeConversationId) {
      query = query.neq('conversation_id', excludeConversationId);
    }

    const { data, error } = await query;

    if (error) throw error;
    return (data || []).map((item: any) => ({
      conversationId: item.conversation_id,
      conversation: item.conversation,
    }));
  },

  async add(conversationId: string, sourceId: string, skipCrawlJob?: boolean) {
    // Insert the relationship
    const { data, error } = await supabase
      .from('conversation_sources')
      .insert({
        conversation_id: conversationId,
        source_id: sourceId,
      })
      .select()
      .single();

    if (error) throw error;

    // Only create a crawl job if not inheriting (skipCrawlJob = true means inheriting)
    if (!skipCrawlJob) {
      // Create a crawl job for this source if one doesn't exist
      const existingJobs = await crawlJobsApi.listBySource(sourceId);
      const activeJob = existingJobs.find(
        j => j.status === 'queued' || j.status === 'running'
      );

      if (!activeJob) {
        await crawlJobsApi.create({
          source_id: sourceId,
          conversation_id: conversationId,
          status: 'queued',
          pages_indexed: 0,
          indexed_count: 0,
          discovered_count: 0,
          links_count: 0,
          total_pages: null,
          error_message: null,
          started_at: null,
          completed_at: null,
          last_activity_at: null,
        });
      }
    }

    return data as ConversationSource;
  },

  async remove(conversationId: string, sourceId: string) {
    const { error } = await supabase
      .from('conversation_sources')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('source_id', sourceId);

    if (error) throw error;
  },
};


