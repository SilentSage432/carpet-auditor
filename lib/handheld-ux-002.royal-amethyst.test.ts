/**
 * HANDHELD-UX-002 — Royal Amethyst theme catalog, tokens, persistence, boot.
 * Personality only. Does not remap operational semantic colors.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyDocumentTheme,
  DEFAULT_THEME,
  DEFAULT_THEME_PREFS,
  parseThemePrefs,
  PRIMARY_THEME_IDS,
  THEME_BOOT_SCRIPT,
  THEME_IDS,
  THEME_PRESETS,
  THEME_STORAGE_KEY,
  themePreset,
  writeThemePrefs,
} from "@/lib/theme";

const root = join(__dirname, "..");

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const REQUIRED_THEME_TOKENS = [
  "--background",
  "--foreground",
  "--surface",
  "--surface-raised",
  "--surface-glass",
  "--panel-bg",
  "--input-bg",
  "--border",
  "--border-strong",
  "--accent",
  "--accent-strong",
  "--accent-fg",
  "--accent-fg-soft",
  "--accent-cyan",
  "--success",
  "--warning",
  "--danger",
  "--muted",
  "--wash-primary",
  "--wash-secondary",
  "--wash-void",
  "--glow-accent",
  "--shadow",
] as const;

const DARK_SEMANTIC = {
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#f87171",
} as const;

const EXISTING_PRIMARY = [
  { id: "midnight", label: "Cyber-Dark", accent: "#7dd3fc" },
  { id: "cobalt", label: "Midnight Sapphire", accent: "#22d3ee" },
  { id: "emerald", label: "Industrial Emerald", accent: "#34d399" },
  { id: "solar", label: "Solar Daylight", accent: "#c2410c" },
] as const;

function cssThemeBlock(css: string, id: string): string {
  const match = css.match(
    new RegExp(`\\[data-theme="${id}"\\][^{]*\\{([\\s\\S]*?)\\n\\}`)
  );
  expect(match, `missing [data-theme="${id}"] block`).toBeTruthy();
  return match?.[1] ?? "";
}

function tokensFromBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    out[`--${row[1]}`] = row[2].trim();
  }
  return out;
}

describe("HANDHELD-UX-002 Royal Amethyst theme", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-contrast");
    document.documentElement.removeAttribute("data-density");
    document.documentElement.style.colorScheme = "";
    document.head
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((el) => el.remove());
  });

  it("adds Royal Amethyst as the fifth mounted theme without renaming existing ids", () => {
    expect(PRIMARY_THEME_IDS).toEqual([
      "midnight",
      "cobalt",
      "emerald",
      "amethyst",
      "solar",
    ]);
    expect(PRIMARY_THEME_IDS).toHaveLength(5);
    expect(DEFAULT_THEME).toBe("midnight");
    expect(DEFAULT_THEME_PREFS.theme).toBe("midnight");

    const mounted = THEME_PRESETS.filter((row) =>
      (PRIMARY_THEME_IDS as readonly string[]).includes(row.id)
    );
    expect(mounted.map((row) => row.id)).toEqual([
      "midnight",
      "cobalt",
      "emerald",
      "amethyst",
      "solar",
    ]);
    expect(mounted.map((row) => row.label)).toEqual([
      "Cyber-Dark",
      "Midnight Sapphire",
      "Industrial Emerald",
      "Royal Amethyst",
      "Solar Daylight",
    ]);

    for (const row of EXISTING_PRIMARY) {
      const preset = themePreset(row.id);
      expect(preset.label).toBe(row.label);
      expect(preset.swatch.accent).toBe(row.accent);
    }
  });

  it("gives Royal Amethyst a unique id and complete truthful swatches", () => {
    const preset = themePreset("amethyst");
    expect(preset.id).toBe("amethyst");
    expect(preset.label).toBe("Royal Amethyst");
    expect(preset.description).toMatch(/charcoal|violet/i);
    expect(preset.themeColor).toBe("#0a0712");
    expect(preset.swatch).toEqual({
      void: "#0a0712",
      surface: "#15101c",
      accent: "#c4b5fd",
      secondary: "#7c3aed",
    });
    expect(THEME_IDS.filter((id) => id === "amethyst")).toHaveLength(1);
    expect(["midnight", "emerald", "amber", "obsidian", "cobalt", "solar"]).not.toContain(
      "royal-amethyst"
    );
  });

  it("supplies a complete amethyst CSS token block matching the catalog", () => {
    const css = readRepo("app/globals.css");
    const tokens = tokensFromBlock(cssThemeBlock(css, "amethyst"));
    for (const key of REQUIRED_THEME_TOKENS) {
      expect(tokens[key], key).toBeTruthy();
    }
    expect(tokens["--background"]).toBe("#0a0712");
    expect(tokens["--surface"]).toBe("#15101c");
    expect(tokens["--accent"]).toBe("#c4b5fd");
    expect(tokens["--accent-strong"]).toBe("#7c3aed");
    expect(tokens["--foreground"]).toBe("#f4f1f8");
    expect(tokens["--muted"]).toBe("#b0a9c2");
    expect(tokens["--success"]).toBe(DARK_SEMANTIC.success);
    expect(tokens["--warning"]).toBe(DARK_SEMANTIC.warning);
    expect(tokens["--danger"]).toBe(DARK_SEMANTIC.danger);
    expect(tokens["--accent"]).not.toBe(tokens["--success"]);
    expect(tokens["--accent"]).not.toBe(tokens["--warning"]);
    expect(tokens["--accent"]).not.toBe(tokens["--danger"]);
    expect(themePreset("amethyst").swatch.void).toBe(tokens["--background"]);
    expect(themePreset("amethyst").swatch.surface).toBe(tokens["--surface"]);
    expect(themePreset("amethyst").swatch.accent).toBe(tokens["--accent"]);
    expect(themePreset("amethyst").swatch.secondary).toBe(
      tokens["--accent-strong"]
    );
  });

  it("does not alter existing mounted theme palettes", () => {
    const css = readRepo("app/globals.css");
    const midnight = tokensFromBlock(cssThemeBlock(css, "midnight"));
    const cobalt = tokensFromBlock(cssThemeBlock(css, "cobalt"));
    const emerald = tokensFromBlock(cssThemeBlock(css, "emerald"));
    const solar = tokensFromBlock(cssThemeBlock(css, "solar"));
    expect(midnight["--accent"]).toBe("#7dd3fc");
    expect(midnight["--background"]).toBe("#070b14");
    expect(cobalt["--accent"]).toBe("#22d3ee");
    expect(cobalt["--background"]).toBe("#020617");
    expect(emerald["--accent"]).toBe("#34d399");
    expect(emerald["--success"]).toBe("#34d399");
    expect(solar["--accent"]).toBe("#c2410c");
    expect(solar["--background"]).toBe("#f4f1e0");
  });

  it("persists Royal Amethyst through the existing device-local blob", () => {
    const parsed = parseThemePrefs(
      JSON.stringify({
        theme: "amethyst",
        highContrast: true,
        compactDensity: true,
        soundEnabled: false,
        hapticsEnabled: false,
      })
    );
    expect(parsed).toEqual({
      theme: "amethyst",
      highContrast: true,
      compactDensity: true,
      soundEnabled: false,
      hapticsEnabled: false,
    });

    const written = writeThemePrefs({
      theme: "amethyst",
      highContrast: false,
      compactDensity: true,
      soundEnabled: true,
      hapticsEnabled: true,
    });
    expect(written.theme).toBe("amethyst");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toContain(
      '"theme":"amethyst"'
    );
    expect(parseThemePrefs(window.localStorage.getItem(THEME_STORAGE_KEY)).theme).toBe(
      "amethyst"
    );
  });

  it("keeps invalid/stale theme fallback on midnight", () => {
    expect(parseThemePrefs(null).theme).toBe("midnight");
    expect(parseThemePrefs("{")).toEqual(DEFAULT_THEME_PREFS);
    expect(parseThemePrefs(JSON.stringify({ theme: "ultraviolet" })).theme).toBe(
      "midnight"
    );
    expect(parseThemePrefs(JSON.stringify({ theme: "royal-amethyst" })).theme).toBe(
      "midnight"
    );
  });

  it("applies amethyst before paint via the existing boot allowlist", () => {
    expect(THEME_BOOT_SCRIPT).toContain('"amethyst"');
    expect(THEME_BOOT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_BOOT_SCRIPT).toContain('"midnight"');
    expect(THEME_BOOT_SCRIPT).not.toContain("fetch(");
    expect(THEME_BOOT_SCRIPT).not.toContain("supabase");
  });

  it("expresses high contrast and density independently of Royal Amethyst", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);

    applyDocumentTheme({
      theme: "amethyst",
      highContrast: true,
      compactDensity: true,
      soundEnabled: true,
      hapticsEnabled: true,
    });
    const rootEl = document.documentElement;
    expect(rootEl.getAttribute("data-theme")).toBe("amethyst");
    expect(rootEl.getAttribute("data-contrast")).toBe("high");
    expect(rootEl.getAttribute("data-density")).toBe("compact");
    expect(rootEl.style.colorScheme).toBe("dark");
    expect(meta.getAttribute("content")).toBe("#0a0712");

    applyDocumentTheme({
      theme: "amethyst",
      highContrast: false,
      compactDensity: false,
      soundEnabled: true,
      hapticsEnabled: true,
    });
    expect(rootEl.getAttribute("data-theme")).toBe("amethyst");
    expect(rootEl.getAttribute("data-contrast")).toBe("normal");
    expect(rootEl.getAttribute("data-density")).toBe("comfortable");
  });

  it("does not remap operational semantic colors onto the amethyst accent", () => {
    const grid = readRepo("components/admin/StoreLocationGrid.tsx");
    expect(grid).toContain('if (tone === "verified") return "#34d399"');
    expect(grid).toContain('if (tone === "scheduled") return "#fbbf24"');
    expect(grid).toContain('if (tone === "attention") return "#fb7185"');
    expect(grid).toContain("bg-amber-500");
    expect(grid).toMatch(/text-rose-400|text-rose-300/);
    expect(grid).not.toMatch(/readinessFill[\s\S]*var\(--accent\)/);

    const walk = readRepo("components/admin/WalkTheFloorSheet.tsx");
    expect(walk).toContain('isHigh ? "bg-amber-500" : "bg-zinc-600"');

    const roster = readRepo("lib/store-ops/roster-people-presentation.ts");
    expect(roster).toContain("text-amber-200/90");
    expect(roster).not.toContain("text-accent");

    const onDuty = readRepo("components/store-ops/OnDutyAssociateStrip.tsx");
    expect(onDuty).toContain("text-emerald-400/80");

    const verify = readRepo(
      "components/store-ops/SupervisorAuditSummaryModal.tsx"
    );
    expect(verify).toContain("bg-rose-600");
    expect(verify).toContain("border-emerald-400/50");

    const css = readRepo("app/globals.css");
    const amethyst = cssThemeBlock(css, "amethyst");
    expect(amethyst).toContain("--success: #34d399");
    expect(amethyst).toContain("--warning: #fbbf24");
    expect(amethyst).toContain("--danger: #f87171");
    expect(amethyst).not.toContain("--success: #c4b5fd");
    expect(amethyst).not.toContain("--danger: #7c3aed");
  });

  it("keeps Floor off the preferences React subscription and adds no network/schema path", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).not.toContain("useUserPreferences");
    expect(floor).not.toContain("from \"@/lib/theme\"");

    const themeSrc = readRepo("lib/theme.ts");
    expect(themeSrc).not.toContain("supabase");
    expect(themeSrc).not.toContain("fetch(");
    expect(themeSrc).toContain('THEME_STORAGE_KEY = "deptsync_theme_prefs"');
    expect(themeSrc).not.toMatch(/create table|alter table/i);

    const drawer = readRepo("components/hub/UserPreferencesDrawer.tsx");
    expect(drawer).toContain("PRIMARY_THEME_IDS");
    expect(drawer).toContain("preset.swatch.void");
  });
});
