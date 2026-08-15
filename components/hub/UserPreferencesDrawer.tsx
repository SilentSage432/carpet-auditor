"use client";

/**
 * Personal appearance, density, contrast, sound, and haptics.
 * Catalog / persistence: lib/theme.ts. Playback: lib/ui/feedback.ts.
 */

import { useEffect } from "react";
import { HubIcon } from "@/components/hub/NavIcons";
import {
  hapticLight,
  hapticSuccess,
  hapticWarning,
  playErrorTone,
  playSuccessTone,
  playTapTone,
} from "@/lib/ui/feedback";
import { useUserPreferences } from "@/lib/ui/preferences-context";
import { PRIMARY_THEME_IDS, THEME_PRESETS } from "@/lib/theme";

type Props = {
  open: boolean;
  onClose: () => void;
};

const PRIMARY_PRESETS = THEME_PRESETS.filter((row) =>
  (PRIMARY_THEME_IDS as readonly string[]).includes(row.id)
);

export function UserPreferencesDrawer({ open, onClose }: Props) {
  const {
    theme,
    highContrast,
    compactDensity,
    soundEnabled,
    hapticsEnabled,
    setTheme,
    setHighContrast,
    setCompactDensity,
    setSoundEnabled,
    setHapticsEnabled,
  } = useUserPreferences();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="glass-backdrop fixed inset-0 z-[90] flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close appearance and preferences"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-prefs-title"
        className="glass-card theme-modal relative z-10 max-h-[88dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted/50" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
              Appearance &amp; Preferences
            </p>
            <h2 id="user-prefs-title" className="mt-1 text-lg font-bold">
              Handheld experience
            </h2>
            <p className="mt-1 text-sm text-muted">
              This device only — store settings stay in Settings.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon-touch"
            aria-label="Close"
          >
            <HubIcon id="close" className="h-5 w-5" />
          </button>
        </div>

        <p className="glass-subtitle mb-2">Theme</p>
        <div
          role="radiogroup"
          aria-label="Color theme"
          className="mb-4 grid grid-cols-1 gap-2"
        >
          {PRIMARY_PRESETS.map((preset) => {
            const active = theme === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(preset.id)}
                className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 text-left transition active:scale-[0.99] ${
                  active
                    ? "theme-accent-surface ring-1 ring-accent/35"
                    : "theme-quiet-surface"
                }`}
              >
                <span className="flex shrink-0 gap-0.5" aria-hidden>
                  <span
                    className="h-8 w-3.5 rounded-l-md border border-border"
                    style={{ background: preset.swatch.void }}
                  />
                  <span
                    className="h-8 w-3.5 border-y border-border"
                    style={{ background: preset.swatch.surface }}
                  />
                  <span
                    className="h-8 w-3.5 border-y border-border"
                    style={{ background: preset.swatch.accent }}
                  />
                  <span
                    className="h-8 w-3.5 rounded-r-md border border-border"
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
              </button>
            );
          })}
        </div>

        <p className="glass-subtitle mb-2">Display density</p>
        <div
          className="mb-4 grid grid-cols-2 gap-1 rounded-full border border-border bg-surface/70 p-0.5"
          role="group"
          aria-label="Display density"
        >
          <button
            type="button"
            aria-pressed={!compactDensity}
            onClick={() => setCompactDensity(false)}
            className={`min-h-11 rounded-full px-2 font-mono text-[11px] font-bold ${
              !compactDensity ? "bg-accent/25 text-accent" : "text-muted"
            }`}
          >
            Comfortable
          </button>
          <button
            type="button"
            aria-pressed={compactDensity}
            onClick={() => setCompactDensity(true)}
            className={`min-h-11 rounded-full px-2 font-mono text-[11px] font-bold ${
              compactDensity ? "bg-accent/25 text-accent" : "text-muted"
            }`}
          >
            Compact Density
          </button>
        </div>

        <div className="space-y-1.5 border-t border-border pt-3">
          <PrefSwitch
            label="High Contrast Mode"
            hint="Stark borders and solid labels for bright floors"
            checked={highContrast}
            onChange={setHighContrast}
          />
          <PrefSwitch
            label="Sound"
            hint="Chimes for scans, bay clears, and alerts"
            checked={soundEnabled}
            onChange={setSoundEnabled}
          />
          <PrefSwitch
            label="Haptics"
            hint="Vibrate on taps, packdowns, and barriers"
            checked={hapticsEnabled}
            onChange={setHapticsEnabled}
          />
        </div>

        <p className="glass-subtitle mb-2 mt-4">Test this device</p>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => {
              playTapTone({ force: true });
              hapticLight({ force: true });
            }}
            className="btn-secondary-glass flex min-h-12 flex-col items-center justify-center px-2 text-[10px] font-bold uppercase tracking-wide"
            data-no-haptic
          >
            Tap
          </button>
          <button
            type="button"
            onClick={() => {
              playSuccessTone({ force: true });
              hapticSuccess({ force: true });
            }}
            className="btn-secondary-glass flex min-h-12 flex-col items-center justify-center px-2 text-[10px] font-bold uppercase tracking-wide"
            data-no-haptic
          >
            Success
          </button>
          <button
            type="button"
            onClick={() => {
              playErrorTone({ force: true });
              hapticWarning({ force: true });
            }}
            className="btn-secondary-glass flex min-h-12 flex-col items-center justify-center px-2 text-[10px] font-bold uppercase tracking-wide"
            data-no-haptic
          >
            Alert
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="btn-primary-glow mt-4 flex min-h-12 w-full items-center justify-center rounded-xl text-sm font-bold"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function PrefSwitch({
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
