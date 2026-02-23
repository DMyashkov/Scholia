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
  const s = localStorage.getItem(STORAGE_KEY);
  if (s != null) {
    const n = parseInt(s, 10);
    if (!Number.isNaN(n)) return clamp(n);
  }
  return DEFAULT;
}

export function useSidebarWidth() {
  const { user } = useAuthContext();
  const [sidebarWidth, setSidebarWidth] = useState(getInitialWidth);
  const [loaded, setLoaded] = useState(false);

  
  useEffect(() => {
    if (user) {
      userSettingsApi
        .get(user.id)
        .then((s) => {
          if (s?.sidebar_width != null) {
            const w = clamp(s.sidebar_width);
            setSidebarWidth(w);
            localStorage.setItem(STORAGE_KEY, String(w));
          }
        })
        .catch(() => {})
        .finally(() => setLoaded(true));
    } else {
      setLoaded(true);
    }
  }, [user]);

  const saveWidth = useCallback(
    (width: number) => {
      const w = clamp(width);
      localStorage.setItem(STORAGE_KEY, String(w));
      if (user) {
        userSettingsApi.upsertSidebarWidth(user.id, w).catch(() => {});
      }
    },
    [user]
  );

  return { sidebarWidth, setSidebarWidth, saveWidth, loaded, min: MIN, max: MAX, default: DEFAULT };
}