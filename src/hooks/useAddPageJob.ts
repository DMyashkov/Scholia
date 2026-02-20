import { useQuery } from '@tanstack/react-query';
import { ADD_PAGE_JOB } from '@/lib/queryKeys';
import { crawlJobsApi } from '@/lib/db';

/**
 * Fetches the latest add-page crawl job for a source (crawl_job with explicit_crawl_urls).
 * Realtime invalidation is handled by useRealtimeCrawlUpdates.
 */
export function useAddPageJob(conversationId: string | null, sourceId: string | null) {
  return useQuery({
    queryKey: [ADD_PAGE_JOB, conversationId, sourceId],
    queryFn: () =>
      conversationId && sourceId
        ? crawlJobsApi.getLatestWithExplicitUrlsBySource(conversationId, sourceId)
        : Promise.resolve(null),
    enabled: !!conversationId && !!sourceId,
  });
}
