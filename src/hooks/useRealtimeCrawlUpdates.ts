import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import type { CrawlJob, Page, PageEdge } from '@/lib/db/types';

/**
 * Hook to subscribe to realtime updates for crawl progress
 * Updates React Query cache when data changes
 */
export function useRealtimeCrawlUpdates(conversationId: string | null, sourceIds: string[]) {
  const queryClient = useQueryClient();
  const channelsRef = useRef<Array<ReturnType<typeof supabase.channel>>>([]);

  useEffect(() => {
    if (!conversationId || sourceIds.length === 0) {
      return;
    }

    console.log(`🔔 Setting up realtime subscriptions for ${sourceIds.length} source(s)`);

    // Clean up existing channels
    channelsRef.current.forEach(channel => {
      supabase.removeChannel(channel);
    });
    channelsRef.current = [];

    // Subscribe to crawl_jobs updates for all sources
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
          console.log('📊 Crawl job update:', payload.new);
          const job = payload.new as CrawlJob;
          
          // Invalidate ALL crawl job queries to trigger refetch (use predicate to match any query starting with these keys)
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

    // Subscribe to pages inserts for all sources
    const pagesChannel = supabase
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
          console.log('📄 New page:', payload.new);
          const page = payload.new as Page;
          
          // Invalidate ALL pages queries to trigger refetch
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

    // Subscribe to page_edges inserts for all sources
    const edgesChannel = supabase
      .channel(`page-edges:${conversationId}`)
      .on<PageEdge>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'page_edges',
          filter: `source_id=in.(${sourceIds.join(',')})`,
        },
        (payload) => {
          console.log('🔗 New edge:', payload.new);
          const edge = payload.new as PageEdge;
          
          // Invalidate ALL edges queries to trigger refetch
          queryClient.invalidateQueries({ predicate: (query) => {
            const key = query.queryKey;
            return (
              (Array.isArray(key) && key[0] === 'page-edges' && key[1] === edge.source_id) ||
              (Array.isArray(key) && key[0] === 'conversation-page-edges' && key[1] === conversationId)
            );
          }});
          queryClient.invalidateQueries({ queryKey: ['conversation-sources', conversationId] });
        }
      )
      .subscribe();

    channelsRef.current.push(edgesChannel);

    return () => {
      console.log(`🔕 Cleaning up realtime subscriptions for conversation ${conversationId}`);
      channelsRef.current.forEach(channel => {
        supabase.removeChannel(channel);
      });
      channelsRef.current = [];
    };
  }, [conversationId, sourceIds.join(','), queryClient]);
}
