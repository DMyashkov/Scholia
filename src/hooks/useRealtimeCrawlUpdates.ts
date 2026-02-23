import { useEffect, useMemo, useRef } from 'react';
import {
  LATEST_ADD_PAGE_JOB_BY_CONVERSATION_AND_SOURCE,
  PAGE_GRAPH_EDGES_FOR_CONVERSATION,
  PAGES_FOR_CONVERSATION,
  SOURCES_FOR_CONVERSATION,
  CURRENT_CRAWL_JOB_BY_SOURCE,
  LATEST_MAIN_CRAWL_JOB_BY_SOURCES,
  LIST_OF_CRAWL_JOBS_BY_SOURCE,
  CRAWL_JOB_INVALIDATION_PREFIXES,
  COUNT_OF_DISCOVERED_LINKS_BY_SOURCE,
  COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION,
  ENCODED_COUNT_OF_DISCOVERED_LINKS_BY_SOURCE,
  ENCODED_COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION,
  PAGES_BY_SOURCE,
} from '@/lib/queryKeys';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import type { CrawlJob, Page, PageEdge } from '@/lib/db/types';








const EDGES_DEBOUNCE_MS = 200;
const EDGES_TRAILING_MS = 150;
const DISCOVERED_LINKS_DEBOUNCE_MS = 500;
const PAGES_DEBOUNCE_MS = 300;


function queryKeyMatches(key: unknown, prefix: string, second?: unknown): boolean {
  return Array.isArray(key) && key[0] === prefix && (second === undefined || key[1] === second);
}


function predicateForKeys(conversationId: string, pairs: [string, unknown?][]): (query: { queryKey: unknown }) => boolean {
  return (query) => {
    const key = query.queryKey;
    return pairs.some(([prefix, second]) => queryKeyMatches(key, prefix, second ?? conversationId));
  };
}


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

    
    channelsRef.current.forEach(channel => {
      supabase.removeChannel(channel);
    });
    channelsRef.current = [];

    
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
            if (queryKeyMatches(key, CURRENT_CRAWL_JOB_BY_SOURCE, job.source_id)) return true;
            if (prefix === LIST_OF_CRAWL_JOBS_BY_SOURCE && (arg1 === job.source_id || key.length === 1)) return true;
            if (CRAWL_JOB_INVALIDATION_PREFIXES.includes(prefix as (typeof CRAWL_JOB_INVALIDATION_PREFIXES)[number])) return true;
            if (prefix === LATEST_ADD_PAGE_JOB_BY_CONVERSATION_AND_SOURCE && arg1 === conversationId && arg2 === job.source_id && job.explicit_crawl_urls != null) return true;
            return false;
          };
          queryClient.invalidateQueries({ predicate });
          queryClient.invalidateQueries({ queryKey: [SOURCES_FOR_CONVERSATION, conversationId] });
        }
        )
        .subscribe();

      channelsRef.current.push(crawlJobsChannel);
    }

    const syncAfterSubscribe = () => {
      queryClient.invalidateQueries({
        predicate: predicateForKeys(conversationId, [[PAGES_FOR_CONVERSATION]]),
      });
    };

    
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
                queryKeyMatches(query.queryKey, PAGES_BY_SOURCE) ||
                queryKeyMatches(query.queryKey, PAGES_FOR_CONVERSATION, conversationId),
            });
            queryClient.invalidateQueries({ queryKey: [SOURCES_FOR_CONVERSATION, conversationId] });
          })();
        }
      )
            .subscribe((status) => {
              if (status === 'SUBSCRIBED') syncAfterSubscribe();
            })
        : null;
    if (pagesChannel) channelsRef.current.push(pagesChannel);

    
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
          const graphEdgesPredicate = (query: { queryKey: unknown }) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === PAGE_GRAPH_EDGES_FOR_CONVERSATION &&
            query.queryKey[1] === conversationId;
          const doSync = () => {
            const t = Date.now();
            if (import.meta.env.DEV) {
              const since = edgesLastSyncRef.current ? t - edgesLastSyncRef.current : 0;
              console.log('[realtime] graph-edges sync', since ? `${since}ms since last` : 'initial');
            }
            edgesLastSyncRef.current = t;
            queryClient.invalidateQueries({ predicate: graphEdgesPredicate });
            queryClient.refetchQueries({ predicate: graphEdgesPredicate });
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
                  queryClient.invalidateQueries({ queryKey: [COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION, conversationId] });
                  queryClient.invalidateQueries({ predicate: (q) => queryKeyMatches(q.queryKey, COUNT_OF_DISCOVERED_LINKS_BY_SOURCE) });
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
                  queryClient.invalidateQueries({ queryKey: [COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION, conversationId] });
                  queryClient.invalidateQueries({ queryKey: [ENCODED_COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION, conversationId] });
                  queryClient.invalidateQueries({ predicate: (q) => queryKeyMatches(q.queryKey, COUNT_OF_DISCOVERED_LINKS_BY_SOURCE) });
                  queryClient.invalidateQueries({ predicate: (q) => queryKeyMatches(q.queryKey, ENCODED_COUNT_OF_DISCOVERED_LINKS_BY_SOURCE) });
                  
                  queryClient.invalidateQueries({
                    predicate: (q) =>
                      Array.isArray(q.queryKey) && q.queryKey[0] === LATEST_MAIN_CRAWL_JOB_BY_SOURCES,
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
    
    
  }, [conversationId, sourceIdsKey, sourceIds, queryClient]);
}