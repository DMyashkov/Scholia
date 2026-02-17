import { useQuery } from '@tanstack/react-query';
import { crawlJobsApi } from '@/lib/db';

/**
 * Fetches the latest add-page crawl job for a source (crawl_job with explicit_crawl_urls).
 * Realtime invalidation is handled by useRealtimeCrawlUpdates.
 */
export function useAddPageJob(conversationId: string | null, sourceId: string | null) {
  return useQuery({
    queryKey: ['add-page-job', conversationId, sourceId],
    queryFn: () =>
      conversationId && sourceId
        ? crawlJobsApi.getLatestWithExplicitUrlsBySource(conversationId, sourceId)
        : Promise.resolve(null),
    enabled: !!conversationId && !!sourceId,
  });
}
