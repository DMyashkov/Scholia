import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { conversationsApi } from '@/lib/db/conversations';
import type { Conversation } from '@/lib/db/types';
import { useAuthContext } from '@/contexts/AuthContext';
import { optimisticUpdateMulti } from '@/hooks/optimisticMutation';

export const useConversations = () => {
  const { user } = useAuthContext();
  const userId = user?.id || null;

  return useQuery({
    queryKey: ['conversations', userId],
    queryFn: () => conversationsApi.list(userId!),
    enabled: !!userId,
  });
};

export const useConversation = (id: string | null) => {
  return useQuery({
    queryKey: ['conversation', id],
    queryFn: () => {
      if (!id) throw new Error('Conversation ID required');
      return conversationsApi.get(id);
    },
    enabled: !!id,
  });
};

export const useCreateConversation = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const userId = user?.id || null;

  return useMutation({
    mutationFn: (title?: string) => {
      if (!userId) throw new Error('Authentication required');
      return conversationsApi.create({ title: title || 'New Research', dynamic_mode: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', userId] });
    },
  });
};

type UpdateConversationVariables = {
  id: string;
  title?: string;
  dynamic_mode?: boolean;
};

export const useUpdateConversation = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const userId = user?.id || null;

  const optimistic = optimisticUpdateMulti<UpdateConversationVariables>({
    updates: [
      {
        getQueryKey: () => ['conversations', userId],
        merge: (prev, v) =>
          (prev as Conversation[] | undefined)?.map((c) =>
            c.id === v.id ? { ...c, dynamic_mode: v.dynamic_mode! } : c
          ) ?? prev ?? [],
      },
      {
        getQueryKey: (v) => ['conversation', v.id],
        merge: (prev, v) =>
          prev ? { ...(prev as Conversation), dynamic_mode: v.dynamic_mode! } : prev,
      },
    ],
  })(queryClient);

  return useMutation({
    mutationFn: ({ id, title, dynamic_mode }: UpdateConversationVariables) =>
      conversationsApi.update(id, {
        ...(title !== undefined && { title }),
        ...(dynamic_mode !== undefined && { dynamic_mode }),
      }),
    onMutate: async (variables) => {
      if (variables.dynamic_mode === undefined) return undefined;
      return optimistic.onMutate(variables);
    },
    onError: optimistic.onError,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conversations', userId] });
      queryClient.invalidateQueries({ queryKey: ['conversation', variables.id] });
    },
  });
};

export const useDeleteConversation = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const userId = user?.id || null;

  return useMutation({
    mutationFn: (id: string) => conversationsApi.delete(id),
    onSuccess: () => {
      // Invalidate all conversation-related queries
      queryClient.invalidateQueries({ queryKey: ['conversations', userId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['conversation'] });
    },
  });
};

export const DELETE_ALL_CONVERSATIONS_EVENT = 'scholia:conversations-deleted-all';

export const useDeleteAllConversations = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const userId = user?.id || null;

  return useMutation({
    mutationFn: () => conversationsApi.deleteAll(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', userId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['conversation'] });
      window.dispatchEvent(new CustomEvent(DELETE_ALL_CONVERSATIONS_EVENT));
    },
  });
};


