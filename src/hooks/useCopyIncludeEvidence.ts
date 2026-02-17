import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/contexts/AuthContext';
import { userSettingsApi } from '@/lib/db/user-settings';

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

  const upsertMutation = useMutation({
    mutationFn: (copyIncludeEvidence: boolean) =>
      userSettingsApi.upsertCopyIncludeEvidence(user!.id, copyIncludeEvidence),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-settings', user?.id] });
    },
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
