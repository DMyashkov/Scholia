import { useConversationSources } from './useConversationSources';
import { usePages } from './usePages';
import { useCrawlJob } from './useCrawlJobs';
import type { Source, DiscoveredPage } from '@/types/source';

/**
 * Hook to get sources with full data (pages, crawl jobs) for a conversation
 * This properly uses hooks for each source
 */
export function useConversationSourcesWithData(conversationId: string | null) {
  const { data: conversationSources = [] } = useConversationSources(conversationId);
  
  // For each source, we need to load pages and crawl job
  // But we can't use hooks in a map, so we'll return the source IDs
  // and let components use useSourceWithData individually
  
  return conversationSources.map(cs => ({
    sourceId: cs.source.id,
    dbSource: cs.source,
  }));
}
