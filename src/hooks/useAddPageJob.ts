import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { addPageJobsApi } from '@/lib/db';
import type { AddPageJob } from '@/lib/db/types';

/**
 * Fetches the latest add_page_job for a source when adding a page.
 * Subscribes to realtime so status updates (indexing → encoding → completed) flow through.
 */
export function useAddPageJob(conversationId: string | null, sourceId: string | null) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const query = useQuery({
    queryKey: ['add-page-job', conversationId, sourceId],
    queryFn: () =>
      conversationId && sourceId
        ? addPageJobsApi.getLatestBySource(conversationId, sourceId)
        : Promise.resolve(null),
    enabled: !!conversationId && !!sourceId,
  });

  useEffect(() => {
    if (!conversationId || !sourceId) return;

    const channel = supabase
      .channel(`add-page-jobs:${conversationId}:${sourceId}`)
      .on<AddPageJob>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'add_page_jobs',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const job = payload.new as AddPageJob;
          if (job.source_id === sourceId) {
            queryClient.invalidateQueries({ queryKey: ['add-page-job', conversationId, sourceId] });
          }
        }
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [conversationId, sourceId, queryClient]);

  return query;
}
