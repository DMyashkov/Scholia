import { useQuery } from '@tanstack/react-query';
import { addPageJobsApi } from '@/lib/db';

/**
 * Fetches the latest add_page_job for a source when adding a page.
 * Realtime invalidation is handled by useRealtimeCrawlUpdates (single source of truth with crawl_jobs).
 */
export function useAddPageJob(conversationId: string | null, sourceId: string | null) {
  return useQuery({
    queryKey: ['add-page-job', conversationId, sourceId],
    queryFn: () =>
      conversationId && sourceId
        ? addPageJobsApi.getLatestBySource(conversationId, sourceId)
        : Promise.resolve(null),
    enabled: !!conversationId && !!sourceId,
  });
}
