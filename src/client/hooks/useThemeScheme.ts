import { useCallback, useEffect, useState } from 'react';

export type ResolvedScheme = 'light' | 'dark';

const STORAGE_KEY = 'color-scheme';

function getSystemScheme(): ResolvedScheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredOverride(): ResolvedScheme | null {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === 'light' || val === 'dark') {
      return val;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function syncMetaColorScheme(override: ResolvedScheme | null): void {
  if (typeof document === 'undefined') return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'color-scheme';
    document.head.prepend(meta);
  }
  meta.content = override ?? 'light dark';
}

/**
 * Implements the Modern Web Guidance `dark-mode` and `dark-mode-toggle` pattern:
 * - Uses `<meta name="color-scheme">` as the source of truth mapped to `:root` `color-scheme`.
 * - Two-state toggle logic: switches to the opposite of the currently rendered scheme.
 *   If the target scheme matches the current OS preference, removes the stored override
 *   so the page returns to following the system default (`light dark`).
 */
export function useThemeScheme() {
  const [systemScheme, setSystemScheme] = useState<ResolvedScheme>(getSystemScheme);
  const [overrideScheme, setOverrideScheme] = useState<ResolvedScheme | null>(getStoredOverride);

  const resolvedScheme: ResolvedScheme = overrideScheme ?? systemScheme;

  useEffect(() => {
    syncMetaColorScheme(overrideScheme);
  }, [overrideScheme]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemScheme(e.matches ? 'dark' : 'light');
    };
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        const next = e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : null;
        setOverrideScheme(next);
        syncMetaColorScheme(next);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const toggleScheme = useCallback(() => {
    const currentSys = getSystemScheme();
    const currentRendered: ResolvedScheme = overrideScheme ?? currentSys;
    const target: ResolvedScheme = currentRendered === 'dark' ? 'light' : 'dark';

    if (target === currentSys) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      setOverrideScheme(null);
      syncMetaColorScheme(null);
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, target);
      } catch {
        // ignore
      }
      setOverrideScheme(target);
      syncMetaColorScheme(target);
    }
  }, [overrideScheme]);

  return {
    resolvedScheme,
    overrideScheme,
    isDark: resolvedScheme === 'dark',
    toggleScheme
  };
}
