/**
 * Admin Tools event bus — owns the open event + payload types only.
 * Presentation stays in AdminToolsDrawer (dynamically imported).
 */

export type AdminToolsSection =
  | "menu"
  | "bulk"
  | "targets"
  | "store"
  | "diagnostics";

export const ADMIN_TOOLS_EVENT = "deptsync:admin-tools";

export type AdminToolsEventDetail = {
  section?: AdminToolsSection;
  openForceRotation?: boolean;
  openSundayAudit?: boolean;
  openManagerNotes?: boolean;
};

/** Dispatch from any page (e.g. hash deep-links) to open Admin Tools. */
export function openAdminTools(detail?: AdminToolsEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ADMIN_TOOLS_EVENT, { detail: detail ?? {} })
  );
}
