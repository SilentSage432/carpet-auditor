/**
 * Lightweight haptic feedback for native / PWA shells.
 * Wraps navigator.vibrate — no-ops when unsupported (iOS Safari, desktop).
 */

export type HapticStrength = "light" | "medium" | "success";

const DURATION_MS: Record<HapticStrength, number> = {
  light: 30,
  medium: 45,
  success: 50,
};

/** Short pulse for taps / toggles / nav tabs (default ~40ms). */
export function hapticPulse(msOrStrength: number | HapticStrength = 40): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;

  const ms =
    typeof msOrStrength === "number"
      ? Math.max(1, Math.min(80, Math.round(msOrStrength)))
      : DURATION_MS[msOrStrength];

  try {
    navigator.vibrate(ms);
  } catch {
    /* vibrate blocked / unsupported */
  }
}

/** True when Vibration API is available in this browser. */
export function hapticsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  );
}
