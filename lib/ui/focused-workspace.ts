"use client";

/**
 * Focused-workspace occupancy — whether a focused overlay currently owns the
 * mobile viewport.
 *
 * Ownership boundary: this module owns occupancy and nothing else. It does not
 * know what BottomNav is and it never renders. `NavigationHub` is the sole
 * consumer that maps occupancy onto chrome visibility (Art. XVI: persistent
 * chrome must never make operational work unreachable).
 *
 * Occupancy is a count, not a boolean, because focused surfaces provably
 * coexist: `SpecialistEditSheet` opens its pairing dialog while remaining open,
 * and `AisleBayManager` holds four independent overlay slots that nothing
 * prevents from being truthy together. A boolean would restore the nav when the
 * inner surface closed while an outer one still owned the viewport.
 *
 * A module-level store rather than a context: BottomNav is a single global
 * instance rendered from three separate route shells, and focused surfaces sit
 * arbitrarily deep inside keep-alive tab panels. Occupancy is therefore global
 * by nature, and no provider has to be threaded through every shell.
 */

import { useEffect, useSyncExternalStore } from "react";

let occupancy = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Claim the viewport for a focused workspace. The returned release is
 * idempotent so a double-release can never un-hide chrome that another live
 * workspace still owns.
 */
export function acquireFocusedWorkspace(): () => void {
  occupancy += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    occupancy = Math.max(0, occupancy - 1);
    emit();
  };
}

export function focusedWorkspaceCount(): number {
  return occupancy;
}

export function subscribeFocusedWorkspaces(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Declare that the calling surface owns the viewport while `active`.
 *
 * Restoration rides on effect cleanup, so every exit path releases the claim
 * without the surface knowing about chrome: X, Cancel, save-and-close, Escape,
 * backdrop tap, route change, error dismissal, and plain unmount all funnel
 * through the same teardown. There is no "show the nav again" callback to
 * forget, and no path that can leave the nav stuck hidden.
 */
export function useFocusedWorkspace(active: boolean = true): void {
  useEffect(() => {
    if (!active) return;
    return acquireFocusedWorkspace();
  }, [active]);
}

/** Subscribe chrome to occupancy. Server renders as unoccupied. */
export function useFocusedWorkspaceActive(): boolean {
  return useSyncExternalStore(
    subscribeFocusedWorkspaces,
    () => occupancy > 0,
    () => false
  );
}
