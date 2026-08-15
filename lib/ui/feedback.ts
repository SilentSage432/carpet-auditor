/**
 * Tactile + synthesized audio feedback.
 * Zero external assets. Prefs owned by lib/theme.ts (soundEnabled / hapticsEnabled).
 */

import { readThemePrefs } from "@/lib/theme";

export type FeedbackOptions = {
  /** Preview from the preferences drawer even when the toggle is off. */
  force?: boolean;
};

let audioCtx: AudioContext | null = null;

function soundOn(force?: boolean): boolean {
  if (force) return true;
  return readThemePrefs().soundEnabled !== false;
}

function hapticsOn(force?: boolean): boolean {
  if (force) return true;
  return readThemePrefs().hapticsEnabled !== false;
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}

function tone(
  ctx: AudioContext,
  start: number,
  freq: number,
  duration: number,
  peakGain: number,
  type: OscillatorType = "sine"
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Crisp two-tone chime — bay complete / successful scan. */
export function playSuccessTone(options?: FeedbackOptions): void {
  if (!soundOn(options?.force)) return;
  try {
    const ctx = getCtx();
    if (!ctx) return;
    void ctx.resume();
    const now = ctx.currentTime;
    tone(ctx, now, 1046.5, 0.09, 0.13);
    tone(ctx, now + 0.12, 1318.5, 0.11, 0.14);
  } catch {
    /* audio optional */
  }
}

/** Low-frequency alert — barcode mismatch or conflict. */
export function playErrorTone(options?: FeedbackOptions): void {
  if (!soundOn(options?.force)) return;
  try {
    const ctx = getCtx();
    if (!ctx) return;
    void ctx.resume();
    const now = ctx.currentTime;
    tone(ctx, now, 196, 0.16, 0.16, "square");
    tone(ctx, now + 0.14, 130.8, 0.22, 0.14, "square");
  } catch {
    /* audio optional */
  }
}

/** Subtle click — button taps and tab switches. */
export function playTapTone(options?: FeedbackOptions): void {
  if (!soundOn(options?.force)) return;
  try {
    const ctx = getCtx();
    if (!ctx) return;
    void ctx.resume();
    const now = ctx.currentTime;
    tone(ctx, now, 880, 0.035, 0.045, "triangle");
  } catch {
    /* audio optional */
  }
}

function vibrate(pattern: number | number[], force?: boolean): void {
  if (!hapticsOn(force)) return;
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* vibrate blocked / unsupported */
  }
}

/** 10ms light pulse for general taps and toggles. */
export function hapticLight(options?: FeedbackOptions): void {
  vibrate(10, options?.force);
}

/** Dual pulse [20ms, 40ms pause, 30ms] for packdowns / bay clears. */
export function hapticSuccess(options?: FeedbackOptions): void {
  vibrate([20, 40, 30], options?.force);
}

/** Heavy pulse [50ms, 50ms pause, 50ms] for deletions or barrier flags. */
export function hapticWarning(options?: FeedbackOptions): void {
  vibrate([50, 50, 50], options?.force);
}

export function hapticsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  );
}
