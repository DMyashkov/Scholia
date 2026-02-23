import { useQuery } from '@tanstack/react-query';
import { CURRENT_CRAWL_JOB_BY_SOURCE, LIST_OF_CRAWL_JOBS_BY_SOURCE } from '@/lib/queryKeys';
import { crawlJobsApi } from '@/lib/db/crawl-jobs';






export const useCrawlJob = (sourceId: string | null, conversationId?: string | null) => {
  return useQuery({
    queryKey: [CURRENT_CRAWL_JOB_BY_SOURCE, sourceId],
    queryFn: async () => {
      if (!sourceId) throw new Error('Source ID required');
      const jobs = await crawlJobsApi.listBySource(sourceId);
      const inProgress = jobs.find(j => ['queued', 'running', 'indexing', 'encoding'].includes(j.status));
      if (inProgress) return inProgress;
      
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
    queryKey: [LIST_OF_CRAWL_JOBS_BY_SOURCE, sourceId],
    queryFn: () => {
      if (!sourceId) throw new Error('Source ID required');
      return crawlJobsApi.listBySource(sourceId);
    },
    enabled: !!sourceId,
  });
};