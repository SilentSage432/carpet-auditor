"use client";

/**
 * Live theme prefs for Settings / chrome.
 * Persistence and document attributes owned by lib/theme.ts.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyDocumentTheme,
  DEFAULT_THEME_PREFS,
  readThemePrefs,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  writeThemePrefs,
  type ThemeId,
  type ThemePrefs,
} from "@/lib/theme";

type ThemeContextValue = ThemePrefs & {
  setTheme: (theme: ThemeId) => void;
  setHighContrast: (enabled: boolean) => void;
  setCompactDensity: (enabled: boolean) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<ThemePrefs>(DEFAULT_THEME_PREFS);

  useEffect(() => {
    const initial = readThemePrefs();
    setPrefs(initial);
    applyDocumentTheme(initial);

    function onCustom(event: Event) {
      const detail = (event as CustomEvent<ThemePrefs>).detail;
      if (!detail) return;
      setPrefs(detail);
      applyDocumentTheme(detail);
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = readThemePrefs();
      setPrefs(next);
      applyDocumentTheme(next);
    }

    window.addEventListener(THEME_CHANGE_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const commit = useCallback((patch: Partial<ThemePrefs>) => {
    setPrefs((prev) => {
      const next = writeThemePrefs({ ...prev, ...patch });
      applyDocumentTheme(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      ...prefs,
      setTheme: (theme) => commit({ theme }),
      setHighContrast: (highContrast) => commit({ highContrast }),
      setCompactDensity: (compactDensity) => commit({ compactDensity }),
    }),
    [prefs, commit]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
