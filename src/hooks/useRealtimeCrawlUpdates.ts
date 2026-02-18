import { useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import type { CrawlJob, Page, PageEdge } from '@/lib/db/types';

/**
 * Hook to subscribe to realtime updates for crawl progress
 * Updates React Query cache when data changes
 *
 * Edge events can flood (2000+ during crawl) -> ERR_INSUFFICIENT_RESOURCES.
 * Debounce: one sync per 1.2s during burst, one final 800ms after last event.
 */
const EDGES_DEBOUNCE_MS = 1200;
const EDGES_TRAILING_MS = 800;
const DISCOVERED_LINKS_DEBOUNCE_MS = 500;

export function useRealtimeCrawlUpdates(conversationId: string | null, sourceIds: string[]) {
  const queryClient = useQueryClient();
  const sourceIdsKey = useMemo(() => sourceIds.join(','), [sourceIds]);
  const channelsRef = useRef<Array<ReturnType<typeof supabase.channel>>>([]);
  const edgesDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgesLastSyncRef = useRef<number>(0);
  const pagesDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discoveredLinksDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
              (Array.isArray(key) && key[0] === 'crawl-jobs-for-sources-bar') ||
              (Array.isArray(key) && key[0] === 'crawl-jobs-main-for-sources') ||
              // Add-page jobs are now crawl_jobs with explicit_crawl_urls
              (Array.isArray(key) && key[0] === 'add-page-job' && key[1] === conversationId && key[2] === job.source_id && job.explicit_crawl_urls != null)
            );
          }});
          queryClient.invalidateQueries({ queryKey: ['conversation-sources', conversationId] });
        }
        )
        .subscribe();

      channelsRef.current.push(crawlJobsChannel);
    }

    const syncAfterSubscribe = () => {
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey;
        return (
          (Array.isArray(key) && key[0] === 'conversation-pages' && key[1] === conversationId) ||
          (Array.isArray(key) && key[0] === 'conversation-page-edges' && key[1] === conversationId)
        );
      }});
    };

    // Subscribe to pages INSERTs for sources in this conversation.
    const pagesChannel =
      sourceIds.length > 0
        ? supabase
            .channel(`pages:${conversationId}`)
            .on<Page>(
              'postgres_changes',
              {
                event: 'INSERT',
                schema: 'public',
                table: 'pages',
                filter: `source_id=in.(${sourceIds.join(',')})`,
              },
        (payload) => {
          if (pagesDebounceTimerRef.current) clearTimeout(pagesDebounceTimerRef.current);
          pagesDebounceTimerRef.current = setTimeout(() => {
            pagesDebounceTimerRef.current = null;
            queryClient.invalidateQueries({ predicate: (query) => {
              const key = query.queryKey;
              return (
                (Array.isArray(key) && key[0] === 'pages') ||
                (Array.isArray(key) && key[0] === 'conversation-pages' && key[1] === conversationId)
              );
            }});
            queryClient.invalidateQueries({ queryKey: ['conversation-sources', conversationId] });
          }, 300);
        }
      )
            .subscribe((status) => {
              if (status === 'SUBSCRIBED') syncAfterSubscribe();
            })
        : null;
    if (pagesChannel) channelsRef.current.push(pagesChannel);

    // Subscribe to page_edges INSERTs (no filter - conversation_id removed; we invalidate and refetch)
    const edgesChannel = supabase
      .channel(`page-edges:${conversationId}`)
      .on<PageEdge>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'page_edges',
        },
        () => {
          // Debounce: 2000+ edge INSERTs during crawl would exhaust browser connections.
          // One sync per DEBOUNCE_MS during burst, one final after TRAILING_MS of silence.
          const doSync = () => {
            const t = Date.now();
            if (import.meta.env.DEV) {
              const since = edgesLastSyncRef.current ? t - edgesLastSyncRef.current : 0;
              console.log('[realtime] edges sync', since ? `${since}ms since last` : 'initial');
            }
            edgesLastSyncRef.current = t;
            queryClient.invalidateQueries({ predicate: (query) => {
              const key = query.queryKey;
              return Array.isArray(key) && key[0] === 'conversation-page-edges' && key[1] === conversationId;
            }});
            queryClient.refetchQueries({ predicate: (query) => {
              const key = query.queryKey;
              return Array.isArray(key) && key[0] === 'conversation-page-edges' && key[1] === conversationId;
            }});
          };
          const now = Date.now();
          if (edgesLastSyncRef.current === 0 || now - edgesLastSyncRef.current >= EDGES_DEBOUNCE_MS) {
            doSync();
          }
          if (edgesDebounceTimerRef.current) clearTimeout(edgesDebounceTimerRef.current);
          edgesDebounceTimerRef.current = setTimeout(() => {
            edgesDebounceTimerRef.current = null;
            doSync();
          }, EDGES_TRAILING_MS);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') syncAfterSubscribe();
      });

    channelsRef.current.push(edgesChannel);

    // Subscribe to encoded_discovered INSERTs (new links) and UPDATEs (embedding set during encoding)
    // No filter: source_id dropped; RLS restricts to our rows
    const dlChannel =
      sourceIds.length > 0
        ? supabase
            .channel(`discovered-links:${conversationId}`)
            .on(
              'postgres_changes',
              {
                event: 'INSERT',
                schema: 'public',
                table: 'encoded_discovered',
              },
              () => {
                if (discoveredLinksDebounceRef.current) clearTimeout(discoveredLinksDebounceRef.current);
                discoveredLinksDebounceRef.current = setTimeout(() => {
                  discoveredLinksDebounceRef.current = null;
                  queryClient.invalidateQueries({ queryKey: ['discovered-links-counts', conversationId] });
                  queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'discovered-links-count' });
                }, DISCOVERED_LINKS_DEBOUNCE_MS);
              }
            )
            .on(
              'postgres_changes',
              {
                event: 'UPDATE',
                schema: 'public',
                table: 'encoded_discovered',
              },
              () => {
                if (discoveredLinksDebounceRef.current) clearTimeout(discoveredLinksDebounceRef.current);
                discoveredLinksDebounceRef.current = setTimeout(() => {
                  discoveredLinksDebounceRef.current = null;
                  queryClient.invalidateQueries({ queryKey: ['discovered-links-counts', conversationId] });
                  queryClient.invalidateQueries({ queryKey: ['discovered-links-encoded-counts', conversationId] });
                  queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'discovered-links-count' });
                  queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'discovered-links-encoded-count' });
                  // encoding_discovered_done lives on crawl_jobs; invalidate so progress bar gets latest (crawl_jobs realtime may not fire for worker updates)
                  queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'crawl-jobs-main-for-sources' && q.queryKey[2] === conversationId });
                  queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && (q.queryKey[0] === 'crawl-jobs-for-sources' || q.queryKey[0] === 'crawl-jobs-for-sources-bar') });
                }, DISCOVERED_LINKS_DEBOUNCE_MS);
              }
            )
            .subscribe()
        : null;
    if (dlChannel) channelsRef.current.push(dlChannel);

    return () => {
      if (edgesDebounceTimerRef.current) {
        clearTimeout(edgesDebounceTimerRef.current);
        edgesDebounceTimerRef.current = null;
      }
      if (pagesDebounceTimerRef.current) {
        clearTimeout(pagesDebounceTimerRef.current);
        pagesDebounceTimerRef.current = null;
      }
      if (discoveredLinksDebounceRef.current) {
        clearTimeout(discoveredLinksDebounceRef.current);
        discoveredLinksDebounceRef.current = null;
      }
      channelsRef.current.forEach(channel => {
        supabase.removeChannel(channel);
      });
      channelsRef.current = [];
    };
    // sourceIdsKey is useMemo from sourceIds - stable representation for deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, sourceIdsKey, queryClient]);
}
