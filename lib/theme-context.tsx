"use client";

/**
 * Compatibility re-export — UserPreferencesProvider owns the React mirror.
 * Catalog + persistence stay in lib/theme.ts.
 */

export {
  ThemeProvider,
  UserPreferencesProvider,
  useTheme,
  useUserPreferences,
  requestUserPreferencesDrawer,
  PREFERENCES_OPEN_EVENT,
} from "@/lib/ui/preferences-context";
