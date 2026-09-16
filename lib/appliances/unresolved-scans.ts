/**
 * APP-UPC-001A — Bounded device-local unresolved physical scan observations.
 *
 * Raw physical identifiers may exist ONLY here while offline resolution is pending.
 * They must never enter appliance_catalog_offline or durable server catalog tables.
 *
 * Lifecycle: capture → reconnect resolve/teach → durable item_number observation → delete raw.
 */

import { canonicalApplianceScanIdentifier } from "@/lib/appliances/scan-identity";
import { uid } from "@/lib/uid";
import type {
  ApplianceCategory,
  ApplianceConditionTag,
  ApplianceFulfillmentDisposition,
  ApplianceLocationType,
} from "@/lib/types";

export const UNRESOLVED_APPLIANCE_SCANS_KEY = "appliance_unresolved_scans_v1";

/**
 * TTL for abandoned unresolved entries: 7 days.
 * Rationale: store dead zones can span a full shift and occasionally a weekend;
 * existing offline sync expects multi-day replay. Shorter TTL (hours) risks
 * erasing legitimate dead-zone capture before reconnect. Resolved entries are
 * deleted immediately and never wait for TTL.
 */
export const UNRESOLVED_APPLIANCE_SCAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type UnresolvedApplianceScan = {
  id: string;
  store_number: string;
  /** Canonical physical scan identifier (temporary device-local only). */
  scan_identifier: string;
  captured_at: string;
  resolution_state: "pending";
  serial_number: string;
  location: string;
  location_type: ApplianceLocationType;
  condition_tag: ApplianceConditionTag;
  category: ApplianceCategory;
  sub_category: string;
  scanned_by: string;
  location_id?: string;
  aisle?: string;
  bay_number?: number | null;
  audit_session_id?: string | null;
  fulfillment_disposition?: ApplianceFulfillmentDisposition | null;
};

export type UnresolvedApplianceScanCaptureInput = Omit<
  UnresolvedApplianceScan,
  "id" | "scan_identifier" | "resolution_state" | "captured_at"
> & {
  scan_identifier: string;
  captured_at?: string;
  id?: string;
};

function readRaw(): UnresolvedApplianceScan[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(UNRESOLVED_APPLIANCE_SCANS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is UnresolvedApplianceScan =>
        row != null &&
        typeof row === "object" &&
        typeof (row as UnresolvedApplianceScan).id === "string" &&
        typeof (row as UnresolvedApplianceScan).scan_identifier === "string"
    );
  } catch {
    return [];
  }
}

function writeRaw(rows: UnresolvedApplianceScan[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(UNRESOLVED_APPLIANCE_SCANS_KEY, JSON.stringify(rows));
}

export function listUnresolvedApplianceScans(
  storeNumber?: string
): UnresolvedApplianceScan[] {
  const all = purgeStaleUnresolvedApplianceScans(readRaw());
  if (!storeNumber) return all;
  return all.filter((r) => r.store_number === storeNumber);
}

export function countUnresolvedApplianceScans(storeNumber?: string): number {
  return listUnresolvedApplianceScans(storeNumber).length;
}

/** Capture one physical unit observation without catalog identity. */
export function captureUnresolvedApplianceScan(
  input: UnresolvedApplianceScanCaptureInput
): UnresolvedApplianceScan {
  const scan_identifier = canonicalApplianceScanIdentifier(
    input.scan_identifier
  );
  if (!scan_identifier) {
    throw new Error("scan_identifier is required");
  }
  const row: UnresolvedApplianceScan = {
    id: input.id ?? uid(),
    store_number: String(input.store_number ?? "").trim(),
    scan_identifier,
    captured_at: input.captured_at ?? new Date().toISOString(),
    resolution_state: "pending",
    serial_number: String(input.serial_number ?? "").trim(),
    location: String(input.location ?? "").trim(),
    location_type: input.location_type,
    condition_tag: input.condition_tag,
    category: input.category,
    sub_category: String(input.sub_category ?? "").trim(),
    scanned_by: String(input.scanned_by ?? "").trim(),
    location_id: input.location_id,
    aisle: input.aisle,
    bay_number: input.bay_number,
    audit_session_id: input.audit_session_id ?? null,
    fulfillment_disposition: input.fulfillment_disposition ?? null,
  };
  if (!row.store_number) {
    throw new Error("store_number is required");
  }
  const next = purgeStaleUnresolvedApplianceScans([...readRaw(), row]);
  writeRaw(next);
  return row;
}

export function removeUnresolvedApplianceScans(
  ids: string[]
): UnresolvedApplianceScan[] {
  const drop = new Set(ids.filter(Boolean));
  const next = readRaw().filter((r) => !drop.has(r.id));
  writeRaw(next);
  return next;
}

export function removeUnresolvedApplianceScansByIdentifier(
  storeNumber: string,
  scanIdentifier: string
): number {
  const canonical = canonicalApplianceScanIdentifier(scanIdentifier);
  const before = readRaw();
  const next = before.filter(
    (r) =>
      !(
        r.store_number === storeNumber &&
        canonicalApplianceScanIdentifier(r.scan_identifier) === canonical
      )
  );
  writeRaw(next);
  return before.length - next.length;
}

export function clearUnresolvedApplianceScansForStore(
  storeNumber: string
): void {
  writeRaw(readRaw().filter((r) => r.store_number !== storeNumber));
}

export function clearAllUnresolvedApplianceScans(): void {
  writeRaw([]);
}

export function purgeStaleUnresolvedApplianceScans(
  rows: UnresolvedApplianceScan[] = readRaw(),
  nowMs: number = Date.now()
): UnresolvedApplianceScan[] {
  const kept = rows.filter((r) => {
    const t = Date.parse(r.captured_at);
    if (!Number.isFinite(t)) return false;
    return nowMs - t <= UNRESOLVED_APPLIANCE_SCAN_TTL_MS;
  });
  if (kept.length !== rows.length) {
    writeRaw(kept);
  }
  return kept;
}

/** Group pending rows by canonical identifier (for one-teach-many-resolve). */
export function groupUnresolvedByScanIdentifier(
  rows: UnresolvedApplianceScan[]
): Map<string, UnresolvedApplianceScan[]> {
  const map = new Map<string, UnresolvedApplianceScan[]>();
  for (const row of rows) {
    const key = canonicalApplianceScanIdentifier(row.scan_identifier);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}
