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
    case "upsert_appliance_catalog_identifier":
      return "Appliance identifier";
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

/**
 * APP-SYNC-UX-001: what real-world action a queued mutation refers to.
 *
 * A supervisor told "this sync operation is blocked" must be able to recognise the
 * physical thing it describes. This renders only identifiers already present in the
 * payload — never invented, never raw JSON, and never opaque internal ids.
 */
export type SyncActionSubjectField = { label: string; value: string };

type SubjectSpec = { label: string; keys: string[] };

const SYNC_ACTION_SUBJECT_SPECS: Partial<
  Record<SyncAction["type"], SubjectSpec[]>
> = {
  upsert_appliance_catalog_identifier: [
    { label: "Item #", keys: ["item_number"] },
    { label: "Identifier", keys: ["identifier"] },
  ],
  upsert_appliance_catalog: [
    { label: "Item #", keys: ["item_number"] },
    { label: "Description", keys: ["description"] },
  ],
  delete_appliance_catalog: [{ label: "Item #", keys: ["item_number"] }],
  upsert_appliance_scan: [
    { label: "Item #", keys: ["item_number"] },
    { label: "Location", keys: ["location"] },
    { label: "Bay", keys: ["bay_number"] },
    { label: "Aisle", keys: ["aisle"] },
    { label: "Serial", keys: ["serial_number"] },
  ],
  delete_appliance_scan: [
    { label: "Item #", keys: ["item_number"] },
    { label: "Location", keys: ["location"] },
  ],
  upsert_audit: [
    { label: "SKU", keys: ["sku"] },
    { label: "Location", keys: ["location", "sims_location"] },
  ],
  delete_audit: [{ label: "SKU", keys: ["sku"] }],
  upsert_catalog: [
    { label: "SKU", keys: ["sku"] },
    { label: "Name", keys: ["carpet_name", "description"] },
  ],
  delete_catalog: [{ label: "SKU", keys: ["sku"] }],
  upsert_remnant: [
    { label: "SKU", keys: ["sku"] },
    { label: "Location", keys: ["location"] },
  ],
  delete_remnant: [{ label: "SKU", keys: ["sku"] }],
  upsert_specialist: [{ label: "Name", keys: ["name", "username"] }],
  delete_specialist: [{ label: "Name", keys: ["name", "username"] }],
  STORE_OPS_COMPLETE_ROTATION: [
    { label: "Aisle", keys: ["aisle"] },
    { label: "Bay", keys: ["bay_number", "bay"] },
    { label: "Completed by", keys: ["completed_by"] },
  ],
  STORE_OPS_DOWNSTOCK_ADD: [
    { label: "Aisle", keys: ["aisle"] },
    { label: "Bay", keys: ["bay_number", "bay"] },
    { label: "Note", keys: ["note", "description"] },
    { label: "Week", keys: ["week", "assigned_week"] },
  ],
  STORE_OPS_SUNDAY_ASSIGN: [
    { label: "Aisle", keys: ["aisle"] },
    { label: "Bay", keys: ["bay_number", "bay"] },
    { label: "Week", keys: ["week", "week_starting"] },
    { label: "Department", keys: ["department"] },
  ],
};

const SUBJECT_FIELD_LIMIT = 4;
const SUBJECT_VALUE_MAX = 48;
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Opaque machine ids mean nothing on a sales floor — never surface them. */
function isOpaqueIdentifier(value: string): boolean {
  return UUID_RE.test(value);
}

function readPayloadText(
  payload: Record<string, unknown>,
  keys: string[]
): string {
  for (const key of keys) {
    const raw = payload[key];
    if (raw == null) continue;
    if (typeof raw === "object") continue;
    const text = String(raw).trim();
    if (!text) continue;
    if (isOpaqueIdentifier(text)) continue;
    return text.length > SUBJECT_VALUE_MAX
      ? `${text.slice(0, SUBJECT_VALUE_MAX - 1)}…`
      : text;
  }
  return "";
}

export function syncActionSubject(
  action: Pick<SyncAction, "type" | "payload">
): SyncActionSubjectField[] {
  const payload = action.payload ?? {};
  const specs = SYNC_ACTION_SUBJECT_SPECS[action.type] ?? [];
  const fields: SyncActionSubjectField[] = [];

  for (const spec of specs) {
    if (fields.length >= SUBJECT_FIELD_LIMIT) break;
    const value = readPayloadText(payload, spec.keys);
    if (value) fields.push({ label: spec.label, value });
  }

  // Physical-audit membership matters; the session uuid itself does not.
  if (action.type === "upsert_appliance_scan") {
    const sessionId = String(payload.audit_session_id ?? "").trim();
    if (sessionId) {
      if (fields.length >= SUBJECT_FIELD_LIMIT) fields.pop();
      fields.push({ label: "Part of", value: "Physical audit count" });
    }
  }

  return fields;
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
    case "blocked_missing_parent":
      return "Appliance item not on DeptSync for this store yet";
    case "unknown":
      return "Unknown sync failure";
    default:
      return "Sync blocked";
  }
}

/**
 * Field-readable explanation for a blocked queue action whose cause is proven
 * (APP-CAT-001A-FIX-001B), naming the real item when the payload carries it.
 *
 * Returns null when there is nothing more truthful to say than the reason label —
 * the panel then falls back to `syncFailureReasonLabel`. Raw constraint text stays
 * secondary diagnostics; it is never the primary message.
 */
export function syncActionBlockedExplanation(
  action: Pick<SyncAction, "payload" | "failure_reason">
): string | null {
  if (action.failure_reason !== "blocked_missing_parent") return null;

  const itemNumber = String(action.payload?.item_number ?? "").trim();
  if (itemNumber) {
    return `Item ${itemNumber} is not on DeptSync for this store yet. Add the item, then Retry.`;
  }
  return "The appliance item must be added to DeptSync before this identifier can sync. Add the item, then Retry.";
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
