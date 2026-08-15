/**
 * Native / PWA haptics — composes lib/ui/feedback.ts.
 * Does not own prefs; feedback.ts gates on hapticsEnabled.
 */

import {
  hapticLight,
  hapticSuccess,
  hapticWarning,
  hapticsSupported,
} from "@/lib/ui/feedback";

export type HapticStrength = "light" | "medium" | "success" | "warning";

export function hapticPulse(msOrStrength: number | HapticStrength = 40): void {
  if (typeof msOrStrength === "number") {
    hapticLight();
    return;
  }
  if (msOrStrength === "success") {
    hapticSuccess();
    return;
  }
  if (msOrStrength === "medium" || msOrStrength === "warning") {
    hapticWarning();
    return;
  }
  hapticLight();
}

export { hapticsSupported };
