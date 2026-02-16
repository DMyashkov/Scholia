import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { userSettingsApi } from '@/lib/db/user-settings';

const STORAGE_KEY = 'scholia-sidebar-width';
const MIN = 200;
const MAX = 900;
const DEFAULT = 600;

function clamp(v: number): number {
  return Math.max(MIN, Math.min(MAX, Math.round(v)));
}

function getInitialWidth(): number {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s != null) {
      const n = parseInt(s, 10);
      if (!Number.isNaN(n)) return clamp(n);
    }
  } catch {
    /* ignore */
  }
  return DEFAULT;
}

export function useSidebarWidth() {
  const { user } = useAuthContext();
  const [sidebarWidth, setSidebarWidth] = useState(getInitialWidth);
  const [loaded, setLoaded] = useState(false);

  // Load on mount or when user changes (DB overrides localStorage for logged-in users)
  useEffect(() => {
    if (user) {
      userSettingsApi
        .get(user.id)
        .then((s) => {
          if (s?.sidebar_width != null) {
            const w = clamp(s.sidebar_width);
            setSidebarWidth(w);
            try {
              localStorage.setItem(STORAGE_KEY, String(w));
            } catch {
              /* ignore */
            }
          }
        })
        .catch(() => {})
        .finally(() => setLoaded(true));
    } else {
      // Anonymous: already initialized from localStorage in useState
      setLoaded(true);
    }
  }, [user]);

  const saveWidth = useCallback(
    (width: number) => {
      const w = clamp(width);
      try {
        localStorage.setItem(STORAGE_KEY, String(w));
      } catch {
        /* ignore */
      }
      if (user) {
        userSettingsApi.upsertSidebarWidth(user.id, w).catch(() => {});
      }
    },
    [user]
  );

  return { sidebarWidth, setSidebarWidth, saveWidth, loaded, min: MIN, max: MAX, default: DEFAULT };
}
