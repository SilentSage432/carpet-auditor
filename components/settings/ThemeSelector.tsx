"use client";

/**
 * Appearance personalization — presentation only.
 * Theme catalog / persistence owned by lib/theme.ts.
 */

import { THEME_PRESETS } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export function ThemeSelector() {
  const {
    theme,
    highContrast,
    compactDensity,
    setTheme,
    setHighContrast,
    setCompactDensity,
  } = useTheme();

  return (
    <section className="glass-card space-y-3 p-3">
      <div>
        <p className="glass-subtitle text-accent">Appearance</p>
        <h2 className="glass-title mt-0.5 text-base">Theme Engine</h2>
        <p className="glass-muted mt-0.5 text-xs">
          Applies instantly on this device — no reload.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Color theme"
        className="grid grid-cols-1 gap-2"
      >
        {THEME_PRESETS.map((preset) => {
          const active = theme === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(preset.id)}
              className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 text-left transition active:scale-[0.99] ${
                active ? "theme-accent-surface ring-1 ring-accent/35" : "theme-quiet-surface"
              }`}
            >
              <span className="flex shrink-0 gap-0.5" aria-hidden>
                <span
                  className="h-8 w-3.5 rounded-l-md border border-white/10"
                  style={{ background: preset.swatch.void }}
                />
                <span
                  className="h-8 w-3.5 border-y border-white/10"
                  style={{ background: preset.swatch.surface }}
                />
                <span
                  className="h-8 w-3.5 border-y border-white/10"
                  style={{ background: preset.swatch.accent }}
                />
                <span
                  className="h-8 w-3.5 rounded-r-md border border-white/10"
                  style={{ background: preset.swatch.secondary }}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-foreground">
                  {preset.label}
                </span>
                <span className="glass-muted block text-xs">
                  {preset.description}
                </span>
              </span>
              <span
                className={`h-4 w-4 shrink-0 rounded-full border ${
                  active
                    ? "border-accent bg-accent"
                    : "border-border bg-transparent"
                }`}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      <div className="space-y-1.5 border-t border-border pt-3">
        <ThemeSwitch
          label="High Contrast Mode"
          hint="Crisper card borders for bright store lighting"
          checked={highContrast}
          onChange={setHighContrast}
        />
        <ThemeSwitch
          label="Compact Density Mode"
          hint="Tighter rows for more bays per screen"
          checked={compactDensity}
          onChange={setCompactDensity}
        />
      </div>
    </section>
  );
}

function ThemeSwitch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full items-center gap-3 rounded-xl px-1 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {label}
        </span>
        <span className="glass-muted block text-xs">{hint}</span>
      </span>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          checked ? "bg-accent" : "bg-surface-raised"
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${
            checked ? "left-[1.35rem]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
