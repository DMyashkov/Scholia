import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { conversationsApi } from '@/lib/db/conversations';
import { useAuthContext } from '@/contexts/AuthContext';

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

export const useUpdateConversation = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const userId = user?.id || null;

  return useMutation({
    mutationFn: ({ id, title, dynamic_mode }: { id: string; title?: string; dynamic_mode?: boolean }) =>
      conversationsApi.update(id, { ...(title !== undefined && { title }), ...(dynamic_mode !== undefined && { dynamic_mode }) }),
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


