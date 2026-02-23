import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PAGE_EDGES_FOR_CONVERSATION,
  PAGE_GRAPH_EDGES_FOR_CONVERSATION,
  PAGES_FOR_CONVERSATION,
  PAGES_BY_SOURCE,
} from '@/lib/queryKeys';
import { pagesApi, pageEdgesApi } from '@/lib/db/pages';

export const usePages = (sourceId: string | null) => {
  return useQuery({
    queryKey: [PAGES_BY_SOURCE, sourceId],
    queryFn: () => {
      if (!sourceId) throw new Error('Source ID required');
      return pagesApi.listBySource(sourceId);
    },
    enabled: !!sourceId,
  });
};

export type UseConversationPagesOptions = {
  
  refetchInterval?: number | false | (() => number | false);
};

export const useConversationPages = (
  conversationId: string | null,
  options?: UseConversationPagesOptions
) => {
  return useQuery({
    queryKey: [PAGES_FOR_CONVERSATION, conversationId],
    queryFn: () => {
      if (!conversationId) throw new Error('Conversation ID required');
      return pagesApi.listByConversation(conversationId);
    },
    enabled: !!conversationId,
    refetchInterval: options?.refetchInterval,
  });
};

export const usePageEdges = (sourceId: string | null) => {
  return useQuery({
    queryKey: ['page-edges', sourceId],
    queryFn: () => {
      if (!sourceId) throw new Error('Source ID required');
      return pageEdgesApi.listBySource(sourceId);
    },
    enabled: !!sourceId,
  });
};

export type UseConversationPageEdgesOptions = {
  
  refetchInterval?: number | false | (() => number | false);
};

export const useConversationPageEdges = (
  conversationId: string | null,
  options?: UseConversationPageEdgesOptions
) => {
  return useQuery({
    queryKey: [PAGE_EDGES_FOR_CONVERSATION, conversationId],
    queryFn: () => {
      if (!conversationId) throw new Error('Conversation ID required');
      return pageEdgesApi.listByConversation(conversationId);
    },
    enabled: !!conversationId,
    refetchInterval: options?.refetchInterval,
  });
};





export const useConversationGraphEdges = (conversationId: string | null, pageIds: string[]) => {
  const pageIdsKey = useMemo(() => [...pageIds].sort().join(','), [pageIds]);
  return useQuery({
    queryKey: [PAGE_GRAPH_EDGES_FOR_CONVERSATION, conversationId, pageIdsKey],
    queryFn: () => {
      if (!conversationId) throw new Error('Conversation ID required');
      return pageEdgesApi.listGraphEdgesByConversation(conversationId, pageIds);
    },
    enabled: !!conversationId && pageIds.length > 0,
  });
};