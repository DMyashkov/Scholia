import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';

const DEFAULT_ERROR_MESSAGE = 'Failed to update setting';

/**
 * Returns onMutate, onError, and optionally onSettled for a single-query optimistic update.
 * Use for mutations that update one cache key (e.g. user-settings).
 */
export function optimisticUpdateSingle<TData, TVariables>(config: {
  queryKey: QueryKey;
  merge: (previous: TData | undefined, variables: TVariables) => TData;
  errorMessage?: string;
  invalidateOnSettled?: boolean;
}) {
  const {
    queryKey,
    merge,
    errorMessage = DEFAULT_ERROR_MESSAGE,
    invalidateOnSettled = true,
  } = config;

  return (queryClient: QueryClient) => ({
    onMutate: async (variables: TVariables) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TData>(queryKey);
      queryClient.setQueryData(queryKey, merge(previous, variables));
      return { previous };
    },
    onError: (
      _err: unknown,
      _variables: TVariables,
      context: { previous?: TData } | undefined
    ) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      toast.error(errorMessage);
    },
    ...(invalidateOnSettled && {
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey });
      },
    }),
  });
}

/**
 * Returns onMutate and onError for a multi-query optimistic update.
 * Use when several cache keys must be updated together (e.g. conversations list + single conversation).
 */
export function optimisticUpdateMulti<TVariables>(config: {
  updates: Array<{
    getQueryKey: (variables: TVariables) => QueryKey;
    merge: (previous: unknown, variables: TVariables) => unknown;
  }>;
  errorMessage?: string;
}) {
  const { updates, errorMessage = DEFAULT_ERROR_MESSAGE } = config;

  return (queryClient: QueryClient) => ({
    onMutate: async (variables: TVariables) => {
      const previous: Array<{ key: QueryKey; value: unknown }> = [];
      for (const { getQueryKey, merge } of updates) {
        const key = getQueryKey(variables);
        await queryClient.cancelQueries({ queryKey: key });
        const prev = queryClient.getQueryData(key);
        previous.push({ key, value: prev });
        queryClient.setQueryData(key, merge(prev, variables));
      }
      return { previous };
    },
    onError: (
      _err: unknown,
      _variables: TVariables,
      context: { previous?: Array<{ key: QueryKey; value: unknown }> } | undefined
    ) => {
      if (context?.previous) {
        context.previous.forEach(({ key, value }) =>
          queryClient.setQueryData(key, value)
        );
      }
      toast.error(errorMessage);
    },
  });
}
