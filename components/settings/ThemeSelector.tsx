"use client";

/**
 * Settings entry — opens the shared UserPreferencesDrawer.
 * Form lives in the drawer so CSAs get the same handheld controls from the header.
 */

import { requestUserPreferencesDrawer } from "@/lib/ui/preferences-context";

export function ThemeSelector() {
  return (
    <section className="glass-card space-y-3 p-3">
      <div>
        <p className="glass-subtitle text-accent">Appearance</p>
        <h2 className="glass-title mt-0.5 text-base">Theme Engine</h2>
        <p className="glass-muted mt-0.5 text-xs">
          Personal theme, contrast, density, sound, and haptics on this device.
        </p>
      </div>
      <button
        type="button"
        onClick={() => requestUserPreferencesDrawer()}
        className="btn-primary-glow flex min-h-12 w-full items-center justify-center rounded-xl text-sm font-bold"
      >
        🎨 Appearance &amp; Preferences
      </button>
    </section>
  );
}
