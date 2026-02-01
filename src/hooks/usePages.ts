import { useQuery } from '@tanstack/react-query';
import { pagesApi, pageEdgesApi } from '@/lib/db/pages';

export const usePages = (sourceId: string | null) => {
  return useQuery({
    queryKey: ['pages', sourceId],
    queryFn: () => {
      if (!sourceId) throw new Error('Source ID required');
      return pagesApi.listBySource(sourceId);
    },
    enabled: !!sourceId,
  });
};

export type UseConversationPagesOptions = {
  /** When set, refetch on this interval (ms). Use while crawling so graph updates without relying on realtime. */
  refetchInterval?: number | false;
};

export const useConversationPages = (
  conversationId: string | null,
  options?: UseConversationPagesOptions
) => {
  return useQuery({
    queryKey: ['conversation-pages', conversationId],
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
  /** When set, refetch on this interval (ms). Use while crawling so graph updates without relying on realtime. */
  refetchInterval?: number | false;
};

export const useConversationPageEdges = (
  conversationId: string | null,
  options?: UseConversationPageEdgesOptions
) => {
  return useQuery({
    queryKey: ['conversation-page-edges', conversationId],
    queryFn: () => {
      if (!conversationId) throw new Error('Conversation ID required');
      return pageEdgesApi.listByConversation(conversationId);
    },
    enabled: !!conversationId,
    refetchInterval: options?.refetchInterval,
  });
};


