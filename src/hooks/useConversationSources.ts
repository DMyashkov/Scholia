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
      // First, check if source with this URL exists for this user
      const userId = user?.id || null;
      const existingSources = await sourcesApi.list(userId);
      let source = existingSources.find(s => s.url === sourceData.url);

      if (!source) {
        // Create new source
        source = await sourcesApi.create(sourceData);
      }

      // Always create a new crawl job (no sharing between conversations)
      await conversationSourcesApi.add(conversationId, source.id, false);
      return source;
    },
    onSuccess: (_, variables) => {
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


