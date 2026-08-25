/**
 * Offline sync conflict events — presentation listens; sync-queue owns resolution flow.
 */

import type { SyncAction, SyncFailureReason } from "@/lib/sync-queue";

export const SYNC_CONFLICT_EVENT = "deptsync:sync-conflict";

export type SyncConflictChoice = "local" | "server";

export type SyncConflictDetail = {
  action: SyncAction;
  local: Record<string, unknown>;
  server: Record<string, unknown>;
  label: string;
  resolve: (choice: SyncConflictChoice) => void;
};

export class SyncConflictError extends Error {
  action: SyncAction;
  local: Record<string, unknown>;
  server: Record<string, unknown>;

  constructor(
    message: string,
    input: {
      action: SyncAction;
      local: Record<string, unknown>;
      server: Record<string, unknown>;
    }
  ) {
    super(message);
    this.name = "SyncConflictError";
    this.action = input.action;
    this.local = input.local;
    this.server = input.server;
  }
}

export function isSyncConflictError(err: unknown): err is SyncConflictError {
  return err instanceof SyncConflictError;
}

/** Human label for queue action type. */
export function syncActionLabel(type: SyncAction["type"]): string {
  switch (type) {
    case "upsert_audit":
      return "Audit record";
    case "upsert_catalog":
      return "Catalog item";
    case "upsert_remnant":
      return "Remnant";
    case "upsert_specialist":
      return "Roster profile";
    case "upsert_appliance_catalog":
      return "Appliance catalog";
    case "upsert_appliance_scan":
      return "Appliance scan";
    case "delete_audit":
      return "Delete audit";
    case "delete_catalog":
      return "Delete catalog item";
    case "delete_remnant":
      return "Delete remnant";
    case "delete_specialist":
      return "Delete roster profile";
    case "delete_appliance_catalog":
      return "Delete appliance catalog";
    case "delete_appliance_scan":
      return "Delete appliance scan";
    default:
      return "Queued edit";
  }
}

/** Human-readable quarantine failure reason for Settings / diagnostics. */
export function syncFailureReasonLabel(
  reason: SyncFailureReason | null | undefined
): string {
  switch (reason) {
    case "deterministic_4xx":
      return "Rejected by server (validation or permission)";
    case "max_retries_exceeded":
      return "Failed after repeated retries";
    case "unknown":
      return "Unknown sync failure";
    default:
      return "Sync blocked";
  }
}

/** Ask the ConflictResolutionModal to choose; resolves when the supervisor picks. */
export function requestConflictResolution(input: {
  action: SyncAction;
  local: Record<string, unknown>;
  server: Record<string, unknown>;
}): Promise<SyncConflictChoice> {
  if (typeof window === "undefined") {
    return Promise.resolve("server");
  }

  return new Promise((resolve) => {
    const detail: SyncConflictDetail = {
      action: input.action,
      local: input.local,
      server: input.server,
      label: syncActionLabel(input.action.type),
      resolve,
    };
    window.dispatchEvent(
      new CustomEvent<SyncConflictDetail>(SYNC_CONFLICT_EVENT, { detail })
    );
  });
}

/** Stable preview fields for side-by-side comparison. */
export function conflictPreviewFields(
  row: Record<string, unknown>
): Array<{ key: string; value: string }> {
  const preferred = [
    "sku",
    "item_number",
    "carpet_name",
    "name",
    "username",
    "serial_number",
    "location",
    "sims_location",
    "default_sims_location",
    "category",
    "sub_category",
    "roll_width_ft",
    "physical_clf",
    "system_clf",
    "upc_barcode",
    "updated_at",
    "created_at",
    "id",
  ];
  const keys = [
    ...preferred.filter((k) => row[k] != null && String(row[k]).trim() !== ""),
    ...Object.keys(row).filter(
      (k) =>
        !preferred.includes(k) &&
        !k.startsWith("_") &&
        row[k] != null &&
        typeof row[k] !== "object"
    ),
  ].slice(0, 10);

  return keys.map((key) => ({
    key,
    value: formatConflictValue(row[key]),
  }));
}

function formatConflictValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    try {
      return new Date(text).toLocaleString();
    } catch {
      return text;
    }
  }
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}
