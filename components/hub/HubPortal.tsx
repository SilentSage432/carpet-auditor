"use client";

/**
 * Escape keep-alive panel stacking contexts so fixed sheets/modals can paint
 * above the persistent BottomNav (Art. XVI reachability).
 */

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

function subscribe() {
  return () => undefined;
}

export function HubPortal({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
