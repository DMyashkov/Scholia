import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { messagesApi } from '@/lib/db/messages';
import type { MessageInsert } from '@/lib/db/types';

export const useMessages = (conversationId: string | null) => {
  return useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => {
      if (!conversationId) throw new Error('Conversation ID required');
      return messagesApi.list(conversationId);
    },
    enabled: !!conversationId,
  });
};

export const useCreateMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (message: MessageInsert) => messagesApi.create(message),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['messages', variables.conversation_id] });
    },
  });
};

export const useUpdateMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, conversationId, updates }: { id: string; conversationId: string; updates: Record<string, unknown> }) =>
      messagesApi.update(id, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['messages', variables.conversationId] });
    },
  });
};

export const useDeleteMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, conversationId }: { id: string; conversationId: string }) =>
      messagesApi.delete(id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['messages', variables.conversationId] });
    },
  });
};


