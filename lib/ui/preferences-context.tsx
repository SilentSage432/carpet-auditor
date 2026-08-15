"use client";

/**
 * Live user preferences for chrome / drawer.
 * Persistence and document attributes owned by lib/theme.ts.
 * Audio/haptics playback owned by lib/ui/feedback.ts.
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

export const PREFERENCES_OPEN_EVENT = "deptsync:open-preferences";

export function requestUserPreferencesDrawer(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PREFERENCES_OPEN_EVENT));
}

type UserPreferencesContextValue = ThemePrefs & {
  setTheme: (theme: ThemeId) => void;
  setHighContrast: (enabled: boolean) => void;
  setCompactDensity: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setHapticsEnabled: (enabled: boolean) => void;
};

const UserPreferencesContext =
  createContext<UserPreferencesContextValue | null>(null);

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
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

  const value = useMemo<UserPreferencesContextValue>(
    () => ({
      ...prefs,
      setTheme: (theme) => commit({ theme }),
      setHighContrast: (highContrast) => commit({ highContrast }),
      setCompactDensity: (compactDensity) => commit({ compactDensity }),
      setSoundEnabled: (soundEnabled) => commit({ soundEnabled }),
      setHapticsEnabled: (hapticsEnabled) => commit({ hapticsEnabled }),
    }),
    [prefs, commit]
  );

  return (
    <UserPreferencesContext.Provider value={value}>
      {children}
    </UserPreferencesContext.Provider>
  );
}

export function useUserPreferences(): UserPreferencesContextValue {
  const ctx = useContext(UserPreferencesContext);
  if (!ctx) {
    throw new Error(
      "useUserPreferences must be used within UserPreferencesProvider"
    );
  }
  return ctx;
}

/** Alias for existing Theme Engine callers. */
export function useTheme(): UserPreferencesContextValue {
  return useUserPreferences();
}

export const ThemeProvider = UserPreferencesProvider;
