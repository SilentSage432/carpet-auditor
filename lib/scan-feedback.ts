/**
 * Scan confirmation feedback — composes lib/ui/feedback.ts.
 * Does not own AudioContext or prefs.
 */

import {
  hapticSuccess,
  playErrorTone,
  playSuccessTone,
} from "@/lib/ui/feedback";

/** 🟢 High double-beep — valid scan match or audit logged. */
export function playSuccessChime(): void {
  playSuccessTone();
}

/** Short haptic pulse when available (Zebra / mobile). */
export function playSuccessHaptic(): void {
  hapticSuccess();
}

/** Success chime + haptic for continuous floor scan confirmations. */
export function playScanLoggedFeedback(): void {
  playSuccessTone();
  hapticSuccess();
}

/** Unlinked barcode / Quick-Add prompt — mismatch alert. */
export function playQuickAddPrompt(): void {
  playErrorTone();
}
