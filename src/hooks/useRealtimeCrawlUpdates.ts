import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import type { CrawlJob, Page, PageEdge } from '@/lib/db/types';

/**
 * Hook to subscribe to realtime updates for crawl progress
 * Updates React Query cache when data changes
 */
const EDGES_REFETCH_DEBOUNCE_MS = 300;

export function useRealtimeCrawlUpdates(conversationId: string | null, sourceIds: string[]) {
  const queryClient = useQueryClient();
  const channelsRef = useRef<Array<ReturnType<typeof supabase.channel>>>([]);
  const edgesRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    // Clean up existing channels
    channelsRef.current.forEach(channel => {
      supabase.removeChannel(channel);
    });
    channelsRef.current = [];

    // Subscribe to crawl_jobs updates for all sources (needs source_id filter; use in.(...) only here)
    if (sourceIds.length > 0) {
      const crawlJobsChannel = supabase
        .channel(`crawl-jobs:${conversationId}`)
        .on<CrawlJob>(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'crawl_jobs',
            filter: `source_id=in.(${sourceIds.join(',')})`,
          },
        (payload) => {
          const job = payload.new as CrawlJob;

            queryClient.invalidateQueries({ predicate: (query) => {
              const key = query.queryKey;
              return (
                (Array.isArray(key) && key[0] === 'crawl-job' && key[1] === job.source_id) ||
                (Array.isArray(key) && key[0] === 'crawl-jobs' && (key[1] === job.source_id || key.length === 1)) ||
                (Array.isArray(key) && key[0] === 'crawl-jobs-for-sources') ||
                (Array.isArray(key) && key[0] === 'crawl-jobs-for-sources-bar')
              );
            }});
            queryClient.invalidateQueries({ queryKey: ['conversation-sources', conversationId] });
          }
        )
        .subscribe();

      channelsRef.current.push(crawlJobsChannel);
    }

    // Subscribe to pages INSERTs for this conversation only.
    // Use conversation_id=eq (single UUID) so we don't rely on source_id=in.(...) with UUIDs.
    const pagesChannel = supabase
      .channel(`pages:${conversationId}`)
      .on<Page>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (import.meta.env.DEV) console.log('[realtime] pages');
          const page = payload.new as Page;

          queryClient.invalidateQueries({ predicate: (query) => {
            const key = query.queryKey;
            return (
              (Array.isArray(key) && key[0] === 'pages' && key[1] === page.source_id) ||
              (Array.isArray(key) && key[0] === 'conversation-pages' && key[1] === conversationId)
            );
          }});
          queryClient.invalidateQueries({ queryKey: ['conversation-sources', conversationId] });
        }
      )
      .subscribe();

    channelsRef.current.push(pagesChannel);

    // Subscribe to page_edges INSERTs for this conversation only.
    // Use conversation_id=eq (single UUID) so we don't rely on source_id=in.(...) with UUIDs.
    const edgesChannel = supabase
      .channel(`page-edges:${conversationId}`)
      .on<PageEdge>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'page_edges',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (import.meta.env.DEV) console.log('[realtime] page_edges');
          const edge = payload.new as PageEdge;

          queryClient.invalidateQueries({ predicate: (query) => {
            const key = query.queryKey;
            return (
              (Array.isArray(key) && key[0] === 'page-edges' && key[1] === edge.source_id) ||
              (Array.isArray(key) && key[0] === 'conversation-page-edges' && key[1] === conversationId)
            );
          }});
          queryClient.invalidateQueries({ queryKey: ['conversation-sources', conversationId] });

          // Debounce refetch: many edge INSERTs fire in a burst; one refetch after the burst
          // avoids cancelled/raced refetches and lets the UI get the full edge set.
          if (edgesRefetchTimerRef.current) clearTimeout(edgesRefetchTimerRef.current);
          edgesRefetchTimerRef.current = setTimeout(() => {
            edgesRefetchTimerRef.current = null;
            queryClient.refetchQueries({ predicate: (query) => {
              const key = query.queryKey;
              return (
                Array.isArray(key) && key[0] === 'conversation-page-edges' && key[1] === conversationId
              );
            }});
          }, EDGES_REFETCH_DEBOUNCE_MS);
        }
      )
      .subscribe();

    channelsRef.current.push(edgesChannel);

    return () => {
      if (edgesRefetchTimerRef.current) {
        clearTimeout(edgesRefetchTimerRef.current);
        edgesRefetchTimerRef.current = null;
      }
      channelsRef.current.forEach(channel => {
        supabase.removeChannel(channel);
      });
      channelsRef.current = [];
    };
  }, [conversationId, sourceIds.join(','), queryClient]);
}
