import type { RefObject } from "react";

/**
 * Focus + select a text input after modal unmount / React re-render.
 * Uses rAF + short delay so soft keyboards reliably reopen on handhelds.
 */
export function focusAndSelect(
  ref: RefObject<HTMLInputElement | null> | HTMLInputElement | null,
  delayMs = 100
): number {
  if (typeof window === "undefined") return 0;

  return window.setTimeout(() => {
    requestAnimationFrame(() => {
      const el =
        ref && "current" in ref ? ref.current : (ref as HTMLInputElement | null);
      if (!el) return;
      el.focus({ preventScroll: true });
      el.select();
    });
  }, delayMs);
}
