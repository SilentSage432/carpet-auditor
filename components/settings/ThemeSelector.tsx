"use client";

/**
 * Settings entry — opens the shared UserPreferencesDrawer.
 * Form lives in the drawer so CSAs get the same handheld controls from the header.
 */

import { Palette } from "lucide-react";
import { requestUserPreferencesDrawer } from "@/lib/ui/preferences-context";

const ICON_STROKE = 1.75;

export function ThemeSelector() {
  return (
    <button
      type="button"
      onClick={() => requestUserPreferencesDrawer()}
      className="flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-700 px-3 text-sm font-semibold text-zinc-100"
    >
      <Palette className="w-4 h-4 mr-2" strokeWidth={ICON_STROKE} aria-hidden />
      Appearance &amp; Theme
    </button>
  );
}
