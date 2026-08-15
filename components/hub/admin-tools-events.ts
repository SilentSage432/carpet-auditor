/**
 * Admin Tools event bus — owns the open event + payload types only.
 * Presentation stays in AdminToolsDrawer (dynamically imported).
 *
 * Dispatches are synchronous on `window`. A one-shot pending payload is
 * replayed when NavigationHub subscribes so a click before the listener
 * attaches still opens the drawer.
 */

export type AdminToolsSection =
  | "menu"
  | "bulk"
  | "targets"
  | "store"
  | "diagnostics"
  | "roster";

export const ADMIN_TOOLS_EVENT = "deptsync:admin-tools";

export type AdminToolsEventDetail = {
  section?: AdminToolsSection;
  openForceRotation?: boolean;
  openSundayAudit?: boolean;
  openManagerNotes?: boolean;
};

let pendingOpen: AdminToolsEventDetail | null = null;

/** Dispatch from any page (e.g. hash deep-links) to open Admin Tools. */
export function openAdminTools(detail?: AdminToolsEventDetail) {
  const payload: AdminToolsEventDetail = detail ?? {};
  pendingOpen = payload;
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AdminToolsEventDetail>(ADMIN_TOOLS_EVENT, {
      detail: payload,
      bubbles: true,
    })
  );
}

/** Subscribe to open requests; replays a click that arrived before mount. */
export function subscribeAdminTools(
  handler: (detail: AdminToolsEventDetail) => void
): () => void {
  if (typeof window === "undefined") return () => undefined;

  function onEvent(event: Event) {
    const detail =
      (event as CustomEvent<AdminToolsEventDetail>).detail ?? {};
    pendingOpen = null;
    handler(detail);
  }

  window.addEventListener(ADMIN_TOOLS_EVENT, onEvent);
  if (pendingOpen) {
    const replay = pendingOpen;
    pendingOpen = null;
    handler(replay);
  }
  return () => window.removeEventListener(ADMIN_TOOLS_EVENT, onEvent);
}
