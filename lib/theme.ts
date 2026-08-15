/**
 * Theme catalog + document apply — owns personalization tokens.
 * CSS variables in app/globals.css render; ThemeProvider only mirrors prefs.
 */

export const THEME_STORAGE_KEY = "deptsync_theme_prefs";
export const THEME_CHANGE_EVENT = "deptsync:theme-change";

export const THEME_IDS = [
  "midnight",
  "emerald",
  "amber",
  "obsidian",
  "cobalt",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export type ThemePrefs = {
  theme: ThemeId;
  highContrast: boolean;
  compactDensity: boolean;
};

export const DEFAULT_THEME: ThemeId = "midnight";

export const DEFAULT_THEME_PREFS: ThemePrefs = {
  theme: DEFAULT_THEME,
  highContrast: false,
  compactDensity: false,
};

export type ThemePreset = {
  id: ThemeId;
  label: string;
  description: string;
  /** PWA / browser chrome */
  themeColor: string;
  swatch: {
    void: string;
    surface: string;
    accent: string;
    secondary: string;
  };
};

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "midnight",
    label: "Midnight Tactical",
    description: "Deep slate with cool ice-blue accents",
    themeColor: "#070b14",
    swatch: {
      void: "#070b14",
      surface: "#121826",
      accent: "#7dd3fc",
      secondary: "#38bdf8",
    },
  },
  {
    id: "emerald",
    label: "Emerald Ops",
    description: "Rich carbon with vivid emerald accents",
    themeColor: "#090d16",
    swatch: {
      void: "#090d16",
      surface: "#18181b",
      accent: "#34d399",
      secondary: "#10b981",
    },
  },
  {
    id: "amber",
    label: "Amber Precision",
    description: "Deep black with high-contrast gold accents",
    themeColor: "#0a0906",
    swatch: {
      void: "#0a0906",
      surface: "#16140e",
      accent: "#fbbf24",
      secondary: "#f59e0b",
    },
  },
  {
    id: "obsidian",
    label: "Obsidian OLED",
    description: "True black with sharp silver accents",
    themeColor: "#000000",
    swatch: {
      void: "#000000",
      surface: "#0a0a0a",
      accent: "#e4e4e7",
      secondary: "#a1a1aa",
    },
  },
  {
    id: "cobalt",
    label: "Cobalt Command",
    description: "Deep navy with electric cyan accents",
    themeColor: "#020617",
    swatch: {
      void: "#020617",
      surface: "#0b1a36",
      accent: "#22d3ee",
      secondary: "#38bdf8",
    },
  },
];

export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === "string" &&
    (THEME_IDS as readonly string[]).includes(value)
  );
}

export function themePreset(id: ThemeId): ThemePreset {
  return THEME_PRESETS.find((row) => row.id === id) ?? THEME_PRESETS[0];
}

export function parseThemePrefs(raw: string | null | undefined): ThemePrefs {
  if (!raw) return { ...DEFAULT_THEME_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<ThemePrefs>;
    return {
      theme: isThemeId(parsed.theme) ? parsed.theme : DEFAULT_THEME,
      highContrast: Boolean(parsed.highContrast),
      compactDensity: Boolean(parsed.compactDensity),
    };
  } catch {
    return { ...DEFAULT_THEME_PREFS };
  }
}

export function readThemePrefs(): ThemePrefs {
  if (typeof window === "undefined") return { ...DEFAULT_THEME_PREFS };
  try {
    return parseThemePrefs(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_THEME_PREFS };
  }
}

export function writeThemePrefs(prefs: ThemePrefs): ThemePrefs {
  const next: ThemePrefs = {
    theme: isThemeId(prefs.theme) ? prefs.theme : DEFAULT_THEME,
    highContrast: Boolean(prefs.highContrast),
    compactDensity: Boolean(prefs.compactDensity),
  };
  if (typeof window === "undefined") return next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  window.dispatchEvent(
    new CustomEvent(THEME_CHANGE_EVENT, { detail: next })
  );
  return next;
}

export function applyDocumentTheme(prefs: ThemePrefs): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const preset = themePreset(prefs.theme);
  root.setAttribute("data-theme", preset.id);
  root.setAttribute("data-contrast", prefs.highContrast ? "high" : "normal");
  root.setAttribute(
    "data-density",
    prefs.compactDensity ? "compact" : "comfortable"
  );
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", preset.themeColor);
}

/** Blocking boot — keep in sync with parseThemePrefs / applyDocumentTheme. */
export const THEME_BOOT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var raw=localStorage.getItem(k);var p={theme:${JSON.stringify(DEFAULT_THEME)},highContrast:false,compactDensity:false};if(raw){try{var j=JSON.parse(raw);if(typeof j.theme==="string")p.theme=j.theme;p.highContrast=!!j.highContrast;p.compactDensity=!!j.compactDensity;}catch(e){}}var allowed=${JSON.stringify(THEME_IDS)};if(allowed.indexOf(p.theme)<0)p.theme=${JSON.stringify(DEFAULT_THEME)};var el=document.documentElement;el.setAttribute("data-theme",p.theme);el.setAttribute("data-contrast",p.highContrast?"high":"normal");el.setAttribute("data-density",p.compactDensity?"compact":"comfortable");}catch(e){document.documentElement.setAttribute("data-theme",${JSON.stringify(DEFAULT_THEME)});}})();`;
