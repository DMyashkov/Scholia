import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { conversationsApi } from '@/lib/db/conversations';
import { useAuthContext } from '@/contexts/AuthContext';

export const useConversations = () => {
  const { user } = useAuthContext();
  const userId = user?.id || null;

  return useQuery({
    queryKey: ['conversations', userId],
    queryFn: () => conversationsApi.list(userId),
    enabled: true, // Works for both authenticated and guest
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
    mutationFn: (title?: string) =>
      conversationsApi.create({ title: title || 'New Research' }),
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
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      conversationsApi.update(id, { title }),
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


