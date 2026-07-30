import type { RefObject } from "react";

/**
 * Focus helpers for explicit tap-to-type only.
 * Do NOT call focus on tab/section mount — that forces the soft keyboard open.
 * Hardware scanners use `useGlobalBarcodeScanner` instead.
 */

/** Blur the active element (or a specific input) so the soft keyboard dismisses. */
export function blurActiveInput(
  ref?: RefObject<HTMLInputElement | null> | HTMLInputElement | null
): void {
  if (typeof window === "undefined") return;

  const fromRef =
    ref == null
      ? null
      : "current" in ref
        ? ref.current
        : (ref as HTMLInputElement | null);

  const el = fromRef ?? document.activeElement;
  if (el instanceof HTMLElement) {
    el.blur();
  }
}

/**
 * Focus + select — only for rare explicit cases (never on tab switch).
 * Prefer tap-to-type (`selectOnFocus` on inputs) + global hardware scanner.
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
