import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/contexts/AuthContext';
import { userSettingsApi, type UserSettings } from '@/lib/db/user-settings';
import {
  type CopyFormat,
  copyFormatFromLegacy,
  getStoredCopyFormat,
  setStoredCopyFormat,
} from '@/lib/copyMessageText';
import { optimisticUpdateSingle } from '@/hooks/optimisticMutation';

function getLocalFormat(): CopyFormat {
  return getStoredCopyFormat() ?? 'evidence';
}

export function useCopyFormat() {
  const { user } = useAuthContext();
  const queryClient = useQueryClient();
  const [guestFormat, setGuestFormat] = useState<CopyFormat>(getLocalFormat);

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

  const copyFormat: CopyFormat = user
    ? getStoredCopyFormat() ?? copyFormatFromLegacy(settings?.copy_include_evidence ?? true)
    : guestFormat;

  const setCopyFormat = (format: CopyFormat) => {
    setStoredCopyFormat(format);
    if (user) {
      upsertMutation.mutate(format !== 'plain');
    } else {
      setGuestFormat(format);
    }
  };

  useEffect(() => {
    if (!user) setGuestFormat(getLocalFormat());
  }, [user]);

  return {
    copyFormat,
    setCopyFormat,
    isLoading: !!user && isLoading,
  };
}


export function useCopyIncludeEvidence() {
  const { copyFormat, setCopyFormat, isLoading } = useCopyFormat();
  return {
    copyIncludeEvidence: copyFormat !== 'plain',
    setCopyIncludeEvidence: (include: boolean) =>
      setCopyFormat(include ? (copyFormat === 'debug' ? 'debug' : 'evidence') : 'plain'),
    isLoading,
  };
}
