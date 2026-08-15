"use client";

/**
 * Delegated haptic pulses for primary interactive controls.
 * Owns click → vibrate only; does not own navigation or form logic.
 */

import { useEffect } from "react";
import { hapticLight, playTapTone } from "@/lib/ui/feedback";

function shouldPulse(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const el = target.closest(
    "button, [role='switch'], [role='tab'], a[href], .btn-primary-glow, .btn-grid-action, .btn-grid-action-emerald, .btn-grid-action-amber, .btn-grid-action-neutral, .btn-grid-action-danger, .btn-icon-touch, .btn-quick-touch, .chip-filter, nav[aria-label] a, nav[aria-label] button"
  );
  if (!el) return false;
  if (el instanceof HTMLButtonElement && el.disabled) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;
  if (el.hasAttribute("data-no-haptic")) return false;
  return true;
}

export function HapticsListener() {
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      if (!shouldPulse(e.target)) return;
      hapticLight();
      playTapTone();
    }

    document.addEventListener("pointerdown", onPointerDown, {
      capture: true,
      passive: true,
    });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  return null;
}
