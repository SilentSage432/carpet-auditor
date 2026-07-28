/** Synthesized Web Audio feedback — no external audio files. */

let audioCtx: AudioContext | null = null;

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
  peakGain = 0.12
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** 🟢 High double-beep — valid scan match or audit logged. */
export function playSuccessChime(): void {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    void ctx.resume();
    const now = ctx.currentTime;
    tone(ctx, now, 1046.5, 0.09, 0.13); // C6
    tone(ctx, now + 0.12, 1318.5, 0.11, 0.14); // E6
  } catch {
    /* audio optional */
  }
}

/** 🟡 Soft pop — unlinked barcode opens Quick-Add. */
export function playQuickAddPrompt(): void {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    void ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  } catch {
    /* audio optional */
  }
}
