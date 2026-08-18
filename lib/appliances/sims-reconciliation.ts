/**
 * SIMS / placard reconciliation for appliance bay workflows.
 * Composes catalog + scans already owned by appliance-scans — does not invent on-hands.
 */

import type { WeeklyRotationWithLocation } from "@/lib/store-ops/types";
import type { ApplianceCatalogItem, ApplianceScan } from "@/lib/types";

/** Scans stamped with this bay's location_id, or matching aisle + bay_number. */
export function scansForMappedBay(
  scans: ApplianceScan[],
  rotation: WeeklyRotationWithLocation
): ApplianceScan[] {
  const loc = rotation.store_locations;
  const locId = loc?.id || rotation.location_id;
  const aisle = String(loc?.aisle ?? "")
    .trim()
    .toUpperCase();
  const bay = loc?.bay;
  return (scans ?? []).filter((scan) => {
    if (locId && scan.location_id === locId) return true;
    if (
      aisle &&
      Number.isFinite(bay) &&
      String(scan.aisle ?? "")
        .trim()
        .toUpperCase() === aisle &&
      scan.bay_number === bay
    ) {
      return true;
    }
    return false;
  });
}

export type SimsReconFlag = {
  code: "empty_bay" | "unknown_sku" | "missing_serial";
  message: string;
  item_number?: string;
};

export type SimsReconciliation = {
  scanned_count: number;
  flags: SimsReconFlag[];
};

export function composeSimsReconciliation(input: {
  scans: ApplianceScan[];
  catalog: ApplianceCatalogItem[];
}): SimsReconciliation {
  const scans = input.scans ?? [];
  const catalogNumbers = new Set(
    (input.catalog ?? []).map((row) =>
      String(row.item_number ?? "").trim()
    ).filter(Boolean)
  );

  const flags: SimsReconFlag[] = [];
  if (scans.length === 0) {
    flags.push({
      code: "empty_bay",
      message: "No units scanned in this bay yet — expected SIMS on-hands are unknown.",
    });
    return { scanned_count: 0, flags };
  }

  const seenUnknown = new Set<string>();
  for (const scan of scans) {
    const item = String(scan.item_number ?? "").trim();
    if (item && catalogNumbers.size > 0 && !catalogNumbers.has(item) && !seenUnknown.has(item)) {
      seenUnknown.add(item);
      flags.push({
        code: "unknown_sku",
        message: `${item} is not in this store's appliance catalog.`,
        item_number: item,
      });
    }
    if (
      scan.location_type === "topstock" &&
      !String(scan.serial_number ?? "").trim() &&
      item
    ) {
      flags.push({
        code: "missing_serial",
        message: `${item} is boxed/topstock without a serial.`,
        item_number: item,
      });
    }
  }

  return { scanned_count: scans.length, flags };
}
