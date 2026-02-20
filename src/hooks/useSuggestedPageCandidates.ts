import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/contexts/AuthContext';
import { userSettingsApi, type SuggestedPageCandidates, type UserSettings } from '@/lib/db/user-settings';
import { optimisticUpdateSingle } from '@/hooks/optimisticMutation';

export function useSuggestedPageCandidates() {
  const { user } = useAuthContext();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['user-settings', user?.id],
    queryFn: () => userSettingsApi.get(user!.id),
    enabled: !!user,
  });

  const queryKey = ['user-settings', user?.id] as const;
  const optimistic = optimisticUpdateSingle<UserSettings | null, SuggestedPageCandidates>({
    queryKey,
    merge: (old, value) =>
      old
        ? { ...old, suggested_page_candidates: value }
        : {
            owner_id: user!.id,
            sidebar_width: 600,
            copy_include_evidence: true,
            suggested_page_candidates: value,
            updated_at: new Date().toISOString(),
          },
  })(queryClient);

  const upsertMutation = useMutation({
    mutationFn: (suggestedPageCandidates: SuggestedPageCandidates) =>
      userSettingsApi.upsertSuggestedPageCandidates(user!.id, suggestedPageCandidates),
    ...optimistic,
  });

  const suggestedPageCandidates: SuggestedPageCandidates = settings?.suggested_page_candidates === 10 ? 10 : 5;

  const setSuggestedPageCandidates = (value: SuggestedPageCandidates) => {
    if (user) upsertMutation.mutate(value);
  };

  return {
    suggestedPageCandidates,
    setSuggestedPageCandidates,
    isLoading: !!user && isLoading,
  };
}
