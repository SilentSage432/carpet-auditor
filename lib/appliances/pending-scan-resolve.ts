/**
 * APP-UPC-001A — Client helpers for online resolve + reconnect flush of pending scans.
 */

import {
  captureUnresolvedApplianceScan,
  groupUnresolvedByScanIdentifier,
  listUnresolvedApplianceScans,
  purgeStaleUnresolvedApplianceScans,
  removeUnresolvedApplianceScans,
  type UnresolvedApplianceScan,
} from "@/lib/appliances/unresolved-scans";
import { canonicalApplianceScanIdentifier } from "@/lib/appliances/scan-identity";
import { saveApplianceScan } from "@/lib/appliance-scans";
import { storeOpsAuthHeadersAsync } from "@/lib/store-ops/auth";
import { getStoreNumber } from "@/lib/store";
import { isBrowserOnline } from "@/lib/sync-queue";
import type { ApplianceCatalogItem, ApplianceScan } from "@/lib/types";

export type OnlineResolveScanResult =
  | { status: "matched"; item: ApplianceCatalogItem }
  | { status: "unknown" }
  | { status: "error"; message: string };

export async function resolveApplianceScanOnline(
  scanIdentifier: string,
  storeNumber?: string
): Promise<OnlineResolveScanResult> {
  const canonical = canonicalApplianceScanIdentifier(scanIdentifier);
  if (!canonical) return { status: "error", message: "scan_identifier is required" };
  const store = storeNumber ?? getStoreNumber();
  try {
    const authHeaders = await storeOpsAuthHeadersAsync();
    const res = await fetch("/api/appliances/catalog/resolve-scan", {
      method: "POST",
      headers: {
        ...authHeaders,
        "x-store-number": store,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        store_number: store,
        scan_identifier: canonical,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: string;
      item?: ApplianceCatalogItem;
      error?: string;
    };
    if (!res.ok) {
      return {
        status: "error",
        message: json.error || `Resolve failed (${res.status})`,
      };
    }
    if (json.status === "matched" && json.item) {
      return { status: "matched", item: json.item };
    }
    return { status: "unknown" };
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof Error ? err.message : "Resolve failed (network)",
    };
  }
}

export type FlushUnresolvedResult = {
  resolvedCount: number;
  /** Distinct identifiers that still need teach (fingerprint miss). */
  needsTeach: string[];
  errors: string[];
  savedScans: ApplianceScan[];
};

/**
 * Reconnect flush: resolve each pending identifier once; expand matches into
 * one durable observation per pending unit (preserves physical count cardinality).
 * Does NOT delete pending rows on failure or unknown.
 */
export async function flushUnresolvedApplianceScans(options?: {
  storeNumber?: string;
  /** When set, only flush this canonical identifier. */
  onlyIdentifier?: string;
}): Promise<FlushUnresolvedResult> {
  purgeStaleUnresolvedApplianceScans();
  const store = options?.storeNumber ?? getStoreNumber();
  let pending = listUnresolvedApplianceScans(store);
  if (options?.onlyIdentifier) {
    const only = canonicalApplianceScanIdentifier(options.onlyIdentifier);
    pending = pending.filter(
      (r) => canonicalApplianceScanIdentifier(r.scan_identifier) === only
    );
  }

  const result: FlushUnresolvedResult = {
    resolvedCount: 0,
    needsTeach: [],
    errors: [],
    savedScans: [],
  };

  if (!isBrowserOnline() || pending.length === 0) {
    return result;
  }

  const groups = groupUnresolvedByScanIdentifier(pending);

  for (const [identifier, rows] of groups) {
    const resolved = await resolveApplianceScanOnline(identifier, store);
    if (resolved.status === "error") {
      result.errors.push(resolved.message);
      continue;
    }
    if (resolved.status === "unknown") {
      result.needsTeach.push(identifier);
      continue;
    }

    const item = resolved.item;
    const completedIds: string[] = [];
    for (const row of rows) {
      try {
        const { record } = await saveApplianceScan(
          {
            item_number: item.item_number,
            serial_number: row.serial_number,
            location: row.location,
            location_type: row.location_type,
            condition_tag: row.condition_tag,
            category: item.category,
            sub_category: String(item.sub_category ?? row.sub_category ?? ""),
            scanned_by: row.scanned_by,
            scanned_at: row.captured_at,
            location_id: row.location_id,
            aisle: row.aisle,
            bay_number: row.bay_number,
            audit_session_id: row.audit_session_id,
            fulfillment_disposition: row.fulfillment_disposition,
            store_number: row.store_number,
          },
          { localFirst: true }
        );
        result.savedScans.push(record);
        completedIds.push(row.id);
        result.resolvedCount += 1;
      } catch (err) {
        result.errors.push(
          err instanceof Error ? err.message : "Failed to persist observation"
        );
        // Stop converting this group — leave remaining pending intact.
        break;
      }
    }
    if (completedIds.length > 0) {
      removeUnresolvedApplianceScans(completedIds);
    }
  }

  return result;
}

export function capturePendingApplianceObservation(
  input: Parameters<typeof captureUnresolvedApplianceScan>[0]
): UnresolvedApplianceScan {
  return captureUnresolvedApplianceScan(input);
}

export {
  clearAllUnresolvedApplianceScans,
  clearUnresolvedApplianceScansForStore,
  countUnresolvedApplianceScans,
  listUnresolvedApplianceScans,
} from "@/lib/appliances/unresolved-scans";
