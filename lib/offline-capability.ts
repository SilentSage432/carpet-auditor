/**
 * Floor offline capability matrix — read-only reference for Settings diagnostics.
 * Aligned with DEPT_SYNC_STATE.md §3 parity register.
 */

export type OfflineCapabilityMode = "offline_queue" | "offline_read" | "online_only";

export type OfflineCapabilityRow = {
  module: string;
  mode: OfflineCapabilityMode;
  summary: string;
};

export const OFFLINE_CAPABILITY_ROWS: OfflineCapabilityRow[] = [
  {
    module: "Bay rotation complete",
    mode: "offline_queue",
    summary: "Queued via sync engine; replays on reconnect",
  },
  {
    module: "Sunday audit assignments",
    mode: "offline_queue",
    summary: "Specialist↔bay staging queued offline",
  },
  {
    module: "Downstock / top-stock flags",
    mode: "offline_queue",
    summary: "Flag adds queue; clears when live",
  },
  {
    module: "Flooring / SIMS cycle audit",
    mode: "offline_queue",
    summary: "localStorage + sync queue upsert",
  },
  {
    module: "Appliance & department scans",
    mode: "offline_queue",
    summary: "Catalog + scan rows queue offline",
  },
  {
    module: "Catalog, remnants, roster edits",
    mode: "offline_queue",
    summary: "Standard entity offline stores",
  },
  {
    module: "Store map & floor checklist",
    mode: "offline_read",
    summary: "IndexedDB SWR — last live snapshot only",
  },
  {
    module: "Floor-walk task dispatch",
    mode: "online_only",
    summary: "Requires live Supabase write",
  },
  {
    module: "Associate schedule / call-out",
    mode: "online_only",
    summary: "Shift board writes need network",
  },
  {
    module: "Executive Floor Pad notes",
    mode: "online_only",
    summary: "Manager notes — no offline draft yet",
  },
  {
    module: "Topology CRUD / bulk bays",
    mode: "online_only",
    summary: "Bay setup via API only",
  },
  {
    module: "Snap Bay AI audit persist",
    mode: "online_only",
    summary: "Gemini verdict + bay_audit_logs",
  },
];

export function offlineCapabilityModeLabel(mode: OfflineCapabilityMode): string {
  switch (mode) {
    case "offline_queue":
      return "Offline queue";
    case "offline_read":
      return "Cached read";
    case "online_only":
      return "Online only";
  }
}
