import { useConversationSources } from './useConversationSources';
import { usePages } from './usePages';
import { useCrawlJob } from './useCrawlJobs';
import type { Source, DiscoveredPage } from '@/types/source';





export function useConversationSourcesWithData(conversationId: string | null) {
  const { data: conversationSources = [] } = useConversationSources(conversationId);
  
  
  
  
  
  return conversationSources.map(cs => ({
    sourceId: cs.source.id,
    dbSource: cs.source,
  }));
}