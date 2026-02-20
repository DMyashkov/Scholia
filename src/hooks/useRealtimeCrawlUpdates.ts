import { useEffect, useMemo, useRef } from 'react';
import {
  ADD_PAGE_JOB,
  CRAWL_JOBS_FOR_SOURCES,
  CRAWL_JOBS_FOR_SOURCES_BAR,
  CRAWL_JOBS_LIST,
  CRAWL_JOBS_MAIN_FOR_SOURCES,
  CRAWL_JOB_INVALIDATION_PREFIXES,
  CRAWL_JOB_SINGLE,
  CONVERSATION_PAGE_EDGES,
  CONVERSATION_PAGES,
  CONVERSATION_SOURCES,
  DISCOVERED_LINKS_COUNT_PER_SOURCE,
  DISCOVERED_LINKS_COUNTS_BY_CONVERSATION,
  DISCOVERED_LINKS_ENCODED_COUNT_PER_SOURCE,
  DISCOVERED_LINKS_ENCODED_COUNTS_BY_CONVERSATION,
  PAGES,
} from '@/lib/queryKeys';
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
const PAGES_DEBOUNCE_MS = 300;

/** True if queryKey is an array with key[0] === prefix and (optionally) key[1] === second. */
function queryKeyMatches(key: unknown, prefix: string, second?: unknown): boolean {
  return Array.isArray(key) && key[0] === prefix && (second === undefined || key[1] === second);
}

/** Query predicate: invalidate if key matches any (prefix, second) pair. */
function predicateForKeys(conversationId: string, pairs: [string, unknown?][]): (query: { queryKey: unknown }) => boolean {
  return (query) => {
    const key = query.queryKey;
    return pairs.some(([prefix, second]) => queryKeyMatches(key, prefix, second ?? conversationId));
  };
}

/** Run fn after ms; each call resets the timer. Call the returned function from the event handler. */
function debouncedInvoke(
  timerRef: { current: ReturnType<typeof setTimeout> | null },
  ms: number,
  fn: () => void
): () => void {
  return () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      fn();
    }, ms);
  };
}

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
          const predicate = (query: { queryKey: unknown }) => {
            const key = query.queryKey;
            if (!Array.isArray(key)) return false;
            const [prefix, arg1, arg2] = key;
            if (queryKeyMatches(key, CRAWL_JOB_SINGLE, job.source_id)) return true;
            if (prefix === CRAWL_JOBS_LIST && (arg1 === job.source_id || key.length === 1)) return true;
            if (CRAWL_JOB_INVALIDATION_PREFIXES.includes(prefix as (typeof CRAWL_JOB_INVALIDATION_PREFIXES)[number])) return true;
            if (prefix === ADD_PAGE_JOB && arg1 === conversationId && arg2 === job.source_id && job.explicit_crawl_urls != null) return true;
            return false;
          };
          queryClient.invalidateQueries({ predicate });
          queryClient.invalidateQueries({ queryKey: [CONVERSATION_SOURCES, conversationId] });
        }
        )
        .subscribe();

      channelsRef.current.push(crawlJobsChannel);
    }

    const syncAfterSubscribe = () => {
      queryClient.invalidateQueries({
        predicate: predicateForKeys(conversationId, [[CONVERSATION_PAGES], [CONVERSATION_PAGE_EDGES]]),
      });
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
        () => {
          debouncedInvoke(pagesDebounceTimerRef, PAGES_DEBOUNCE_MS, () => {
            queryClient.invalidateQueries({
              predicate: (query) =>
                queryKeyMatches(query.queryKey, PAGES) ||
                queryKeyMatches(query.queryKey, CONVERSATION_PAGES, conversationId),
            });
            queryClient.invalidateQueries({ queryKey: [CONVERSATION_SOURCES, conversationId] });
          })();
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
          const edgesPredicate = (query: { queryKey: unknown }) =>
            queryKeyMatches(query.queryKey, CONVERSATION_PAGE_EDGES, conversationId);
          const doSync = () => {
            const t = Date.now();
            if (import.meta.env.DEV) {
              const since = edgesLastSyncRef.current ? t - edgesLastSyncRef.current : 0;
              console.log('[realtime] edges sync', since ? `${since}ms since last` : 'initial');
            }
            edgesLastSyncRef.current = t;
            queryClient.invalidateQueries({ predicate: edgesPredicate });
            queryClient.refetchQueries({ predicate: edgesPredicate });
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
                debouncedInvoke(discoveredLinksDebounceRef, DISCOVERED_LINKS_DEBOUNCE_MS, () => {
                  queryClient.invalidateQueries({ queryKey: [DISCOVERED_LINKS_COUNTS_BY_CONVERSATION, conversationId] });
                  queryClient.invalidateQueries({ predicate: (q) => queryKeyMatches(q.queryKey, DISCOVERED_LINKS_COUNT_PER_SOURCE) });
                })();
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
                debouncedInvoke(discoveredLinksDebounceRef, DISCOVERED_LINKS_DEBOUNCE_MS, () => {
                  queryClient.invalidateQueries({ queryKey: [DISCOVERED_LINKS_COUNTS_BY_CONVERSATION, conversationId] });
                  queryClient.invalidateQueries({ queryKey: [DISCOVERED_LINKS_ENCODED_COUNTS_BY_CONVERSATION, conversationId] });
                  queryClient.invalidateQueries({ predicate: (q) => queryKeyMatches(q.queryKey, DISCOVERED_LINKS_COUNT_PER_SOURCE) });
                  queryClient.invalidateQueries({ predicate: (q) => queryKeyMatches(q.queryKey, DISCOVERED_LINKS_ENCODED_COUNT_PER_SOURCE) });
                  // encoding_discovered_done lives on crawl_jobs; invalidate so progress bar gets latest (crawl_jobs realtime may not fire for worker updates)
                  queryClient.invalidateQueries({
                    predicate: (q) =>
                      Array.isArray(q.queryKey) &&
                      q.queryKey[0] === CRAWL_JOBS_MAIN_FOR_SOURCES &&
                      q.queryKey[2] === conversationId,
                  });
                  queryClient.invalidateQueries({
                    predicate: (q) =>
                      queryKeyMatches(q.queryKey, CRAWL_JOBS_FOR_SOURCES) || queryKeyMatches(q.queryKey, CRAWL_JOBS_FOR_SOURCES_BAR),
                  });
                })();
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
