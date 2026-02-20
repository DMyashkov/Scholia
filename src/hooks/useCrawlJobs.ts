import { useQuery } from '@tanstack/react-query';
import { CRAWL_JOB_SINGLE, CRAWL_JOBS_LIST } from '@/lib/queryKeys';
import { crawlJobsApi } from '@/lib/db/crawl-jobs';

/**
 * Current crawl job for a source (in-progress or latest main). Realtime invalidation
 * is handled by useRealtimeCrawlUpdates when viewing a conversation (invalidates
 * crawl-job and crawl-jobs on crawl_jobs changes).
 */
export const useCrawlJob = (sourceId: string | null, conversationId?: string | null) => {
  return useQuery({
    queryKey: [CRAWL_JOB_SINGLE, sourceId, conversationId ?? ''],
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
    queryKey: [CRAWL_JOBS_LIST, sourceId],
    queryFn: () => {
      if (!sourceId) throw new Error('Source ID required');
      return crawlJobsApi.listBySource(sourceId);
    },
    enabled: !!sourceId,
  });
};


