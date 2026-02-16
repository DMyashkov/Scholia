import { useEffect, useRef } from 'react';
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
                (Array.isArray(key) && key[0] === 'crawl-jobs-for-sources-bar')
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
      });

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

    // Subscribe to discovered_links INSERTs for this conversation (dynamic mode, add-page flow)
    const dlChannel = supabase
      .channel(`discovered-links:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'discovered_links',
          filter: `conversation_id=eq.${conversationId}`,
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
      .subscribe();

    channelsRef.current.push(dlChannel);

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
  }, [conversationId, sourceIds.join(','), queryClient]);
}
