import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/contexts/AuthContext';
import { userSettingsApi, type UserSettings } from '@/lib/db/user-settings';
import { optimisticUpdateSingle } from '@/hooks/optimisticMutation';

const STORAGE_KEY = 'scholia-copy-include-evidence';

/** For guests: get from localStorage */
function getLocal(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'false') return false;
    if (v === 'true') return true;
  } catch {
    /* ignore */
  }
  return true;
}

/** For guests: save to localStorage */
function setLocal(include: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(include));
  } catch {
    /* ignore */
  }
}

export function useCopyIncludeEvidence() {
  const { user } = useAuthContext();
  const queryClient = useQueryClient();
  const [guestValue, setGuestValue] = useState(getLocal);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['user-settings', user?.id],
    queryFn: () => userSettingsApi.get(user!.id),
    enabled: !!user,
  });

  const queryKey = ['user-settings', user?.id] as const;
  const optimistic = optimisticUpdateSingle<UserSettings | null, boolean>({
    queryKey,
    merge: (old, copyIncludeEvidence) =>
      old
        ? { ...old, copy_include_evidence: copyIncludeEvidence }
        : {
            owner_id: user!.id,
            sidebar_width: 600,
            copy_include_evidence: copyIncludeEvidence,
            suggested_page_candidates: 5,
            updated_at: new Date().toISOString(),
          },
  })(queryClient);

  const upsertMutation = useMutation({
    mutationFn: (copyIncludeEvidence: boolean) =>
      userSettingsApi.upsertCopyIncludeEvidence(user!.id, copyIncludeEvidence),
    ...optimistic,
  });

  const copyIncludeEvidence = user
    ? (settings?.copy_include_evidence ?? true)
    : guestValue;

  const setCopyIncludeEvidence = (include: boolean) => {
    if (user) {
      upsertMutation.mutate(include);
    } else {
      setLocal(include);
      setGuestValue(include);
    }
  };

  // Sync guest state from localStorage when user becomes null (e.g. logout)
  useEffect(() => {
    if (!user) setGuestValue(getLocal());
  }, [user]);

  return {
    copyIncludeEvidence,
    setCopyIncludeEvidence,
    isLoading: !!user && isLoading,
  };
}
