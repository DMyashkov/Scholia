import { useQuery, useQueryClient } from '@tanstack/react-query';
import { crawlJobsApi } from '@/lib/db/crawl-jobs';
import { supabase } from '@/lib/supabase';
import { useEffect } from 'react';
import type { CrawlJob } from '@/lib/db/types';

export const useCrawlJob = (sourceId: string | null, conversationId?: string | null) => {
  const queryClient = useQueryClient();

  // Set up realtime subscription
  useEffect(() => {
    if (!sourceId) return;

    const channel = supabase
      .channel(`crawl-jobs:${sourceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'crawl_jobs',
          filter: `source_id=eq.${sourceId}`,
        },
        (payload) => {
          queryClient.setQueryData(['crawl-job', sourceId, conversationId ?? ''], payload.new as CrawlJob);
          queryClient.invalidateQueries({ queryKey: ['crawl-jobs', sourceId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sourceId, conversationId, queryClient]);

  return useQuery({
    queryKey: ['crawl-job', sourceId, conversationId ?? ''],
    queryFn: async () => {
      if (!sourceId) throw new Error('Source ID required');
      const jobs = await crawlJobsApi.listBySource(sourceId);
      const inProgress = jobs.find(j => ['queued', 'running', 'indexing', 'encoding'].includes(j.status));
      if (inProgress) return inProgress;
      // Prefer main crawl job for status - add-page failure shouldn't mark source as error
      if (conversationId) {
        const main = await crawlJobsApi.getLatestMainBySource(sourceId, conversationId);
        if (main) return main;
      }
      return jobs[0] || null;
    },
    enabled: !!sourceId,
  });
};

export const useCrawlJobs = (sourceId: string | null) => {
  return useQuery({
    queryKey: ['crawl-jobs', sourceId],
    queryFn: () => {
      if (!sourceId) throw new Error('Source ID required');
      return crawlJobsApi.listBySource(sourceId);
    },
    enabled: !!sourceId,
  });
};


