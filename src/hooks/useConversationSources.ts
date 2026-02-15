import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { conversationSourcesApi } from '@/lib/db/conversation-sources';
import { sourcesApi } from '@/lib/db/sources';
import type { SourceInsert } from '@/lib/db/types';
import { useAuthContext } from '@/contexts/AuthContext';

export type ExistingConversationInfo = {
  conversationId: string;
  conversation: {
    id: string;
    title: string;
    created_at: string;
  };
};

export const useConversationSources = (conversationId: string | null) => {
  return useQuery({
    queryKey: ['conversation-sources', conversationId],
    queryFn: () => {
      if (!conversationId) throw new Error('Conversation ID required');
      return conversationSourcesApi.list(conversationId);
    },
    enabled: !!conversationId,
  });
};

/**
 * Check if a source URL already exists in other conversations
 */
export const useCheckExistingSource = () => {
  return useMutation({
    mutationFn: async ({
      sourceUrl,
      excludeConversationId,
    }: {
      sourceUrl: string;
      excludeConversationId?: string;
    }) => {
      return conversationSourcesApi.findConversationsWithSourceUrl(sourceUrl, excludeConversationId);
    },
  });
};

export const useAddSourceToConversation = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();

  return useMutation({
    mutationFn: async ({
      conversationId,
      sourceData,
    }: {
      conversationId: string;
      sourceData: SourceInsert;
      inheritFromConversationId?: string;
    }) => {
      const userId = user?.id || null;
      const existingSources = await sourcesApi.list(userId);
      let source = existingSources.find(s => s.url === sourceData.url);

      if (!source) {
        source = await sourcesApi.create(sourceData);
      } else {
        source = await sourcesApi.update(source.id, sourceData);
      }

      await conversationSourcesApi.add(conversationId, source.id, false);
      return source;
    },
    onSuccess: (newSource, variables) => {
      // Optimistically add the new source to the conversation-sources cache so the list
      // includes it immediately (avoids source=null in SourceDrawer until refetch completes).
      queryClient.setQueryData(
        ['conversation-sources', variables.conversationId],
        (prev: Array<{ conversation_id: string; source_id: string; created_at: string; source: typeof newSource }> | undefined) => {
          const list = prev ?? [];
          if (list.some(cs => cs.source_id === newSource.id)) return list;
          return [
            ...list,
            {
              conversation_id: variables.conversationId,
              source_id: newSource.id,
              created_at: new Date().toISOString(),
              source: newSource,
            },
          ];
        }
      );
      queryClient.invalidateQueries({ queryKey: ['conversation-sources', variables.conversationId] });
      queryClient.invalidateQueries({ queryKey: ['crawl-jobs'] });
    },
  });
};

export const useRemoveSourceFromConversation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, sourceId }: { conversationId: string; sourceId: string }) =>
      conversationSourcesApi.remove(conversationId, sourceId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conversation-sources', variables.conversationId] });
    },
  });
};


