/**
 * SIMS location stock finder — composes catalog defaults + audit logs.
 * Presentation renders; this module aggregates location stock only.
 */

import { sanitizeBarcodeScan } from "./barcode";
import type { CarpetAudit, CatalogItem, LocationType } from "./types";

export type SimsLocationStock = {
  sims_location: string;
  location_type: LocationType;
  sku: string;
  carpet_name: string;
  category: string;
  /** Cumulative CLF for roll goods at this tag. */
  total_clf: number;
  /** Cumulative sq ft for carton / unit goods. */
  total_sqft: number;
  /** Cumulative carton / unit count. */
  total_boxes: number;
  audit_count: number;
  source: "audit" | "catalog_default";
};

function matchesQuery(
  item: {
    sku: string;
    carpet_name?: string;
    upc_barcode?: string | null;
    sims?: string;
    category?: string;
  },
  raw: string
): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return false;
  const qDigits = sanitizeBarcodeScan(raw);

  if (item.sku.toLowerCase().includes(q)) return true;
  if (item.carpet_name && item.carpet_name.toLowerCase().includes(q)) return true;
  if (item.sims && item.sims.toLowerCase().includes(q)) return true;
  if (item.category && item.category.toLowerCase().includes(q)) return true;
  if (qDigits) {
    if (sanitizeBarcodeScan(item.sku).includes(qDigits)) return true;
    if (
      item.upc_barcode &&
      sanitizeBarcodeScan(item.upc_barcode).includes(qDigits)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Find all physical SIMS locations where a SKU / barcode / tag is staged.
 * Aggregates today's-or-all audit rows by (sku, sims_location, location_type).
 */
export function findSimsLocations(opts: {
  query: string;
  catalog: CatalogItem[];
  audits: CarpetAudit[];
}): SimsLocationStock[] {
  const { query, catalog, audits } = opts;
  const q = query.trim();
  if (!q) return [];

  const matchedSkus = new Set<string>();

  for (const item of catalog) {
    if (
      matchesQuery(
        {
          sku: item.sku,
          carpet_name: item.carpet_name,
          upc_barcode: item.upc_barcode,
          sims: item.default_sims_location,
          category: item.category,
        },
        q
      )
    ) {
      matchedSkus.add(item.sku);
    }
  }

  for (const audit of audits) {
    if (
      matchesQuery(
        {
          sku: audit.sku,
          carpet_name: audit.carpet_name,
          sims: audit.sims_location,
          category: audit.category,
        },
        q
      )
    ) {
      matchedSkus.add(audit.sku);
    }
  }

  // Also treat the query itself as a direct SIMS tag / SKU hit
  const qDigits = sanitizeBarcodeScan(q);
  if (qDigits) {
    for (const item of catalog) {
      if (
        sanitizeBarcodeScan(item.sku) === qDigits ||
        (item.upc_barcode && sanitizeBarcodeScan(item.upc_barcode) === qDigits)
      ) {
        matchedSkus.add(item.sku);
      }
    }
  }

  const byKey = new Map<string, SimsLocationStock>();

  function bump(row: SimsLocationStock) {
    const key = `${row.sku}::${row.sims_location}::${row.location_type}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...row });
      return;
    }
    existing.total_clf += row.total_clf;
    existing.total_sqft += row.total_sqft;
    existing.total_boxes += row.total_boxes;
    existing.audit_count += row.audit_count;
    if (row.source === "audit") existing.source = "audit";
  }

  for (const audit of audits) {
    if (!matchedSkus.has(audit.sku) && !matchesQuery(
      { sku: audit.sku, carpet_name: audit.carpet_name, sims: audit.sims_location },
      q
    )) {
      continue;
    }
    const tag = audit.sims_location.trim() || "(No SIMS tag)";
    bump({
      sims_location: tag,
      location_type: audit.location_type,
      sku: audit.sku,
      carpet_name: audit.carpet_name,
      category: audit.category,
      total_clf: audit.calculated_clf || 0,
      total_sqft: audit.calculated_sqft ?? 0,
      total_boxes: audit.box_count ?? 0,
      audit_count: 1,
      source: "audit",
    });
  }

  // Surface catalog defaults that have a SIMS tag but no audit yet
  for (const item of catalog) {
    if (!matchedSkus.has(item.sku)) continue;
    const tag = item.default_sims_location.trim();
    if (!tag) continue;
    const already = [...byKey.values()].some(
      (r) => r.sku === item.sku && r.sims_location === tag
    );
    if (already) continue;
    bump({
      sims_location: tag,
      location_type: "sales_floor",
      sku: item.sku,
      carpet_name: item.carpet_name,
      category: item.category,
      total_clf: 0,
      total_sqft: 0,
      total_boxes: 0,
      audit_count: 0,
      source: "catalog_default",
    });
  }

  return [...byKey.values()].sort((a, b) => {
    const skuCmp = a.sku.localeCompare(b.sku);
    if (skuCmp !== 0) return skuCmp;
    return a.sims_location.localeCompare(b.sims_location);
  });
}
