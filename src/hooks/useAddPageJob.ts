import { useQuery } from '@tanstack/react-query';
import { LATEST_ADD_PAGE_JOB_BY_CONVERSATION_AND_SOURCE } from '@/lib/queryKeys';
import { crawlJobsApi } from '@/lib/db';





export function useAddPageJob(conversationId: string | null, sourceId: string | null) {
  return useQuery({
    queryKey: [LATEST_ADD_PAGE_JOB_BY_CONVERSATION_AND_SOURCE, conversationId, sourceId],
    queryFn: () =>
      conversationId && sourceId
        ? crawlJobsApi.getLatestWithExplicitUrlsBySource(conversationId, sourceId)
        : Promise.resolve(null),
    enabled: !!conversationId && !!sourceId,
  });
}