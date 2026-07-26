/**
 * Handheld scanner + UPC helpers.
 * Scanners emulate a keyboard and usually end a scan with Enter.
 */

import { stripLeadingZeros } from "./number-input";
import type { CatalogItem } from "./types";

/** Digits only, strip leading zeros (0000084312345678 → 84312345678). */
export function sanitizeBarcodeScan(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return stripLeadingZeros(digits);
}

/** Vendor / UPC-style codes are typically longer than Lowe's item numbers. */
export function isVendorBarcode(value: string): boolean {
  const cleaned = sanitizeBarcodeScan(value);
  return cleaned.length >= 10 && cleaned.length <= 14;
}

export function findCatalogBySkuOrBarcode(
  items: CatalogItem[],
  raw: string
): CatalogItem | undefined {
  const key = sanitizeBarcodeScan(raw);
  if (!key) return undefined;

  return items.find(
    (item) =>
      sanitizeBarcodeScan(item.sku) === key ||
      (item.upc_barcode != null &&
        item.upc_barcode !== "" &&
        sanitizeBarcodeScan(item.upc_barcode) === key)
  );
}

export type ScanResolution =
  | { kind: "matched"; item: CatalogItem; scanned: string }
  | { kind: "unlinked_barcode"; scanned: string }
  | { kind: "unknown_sku"; scanned: string }
  | { kind: "empty" };

export function resolveScan(
  items: CatalogItem[],
  raw: string
): ScanResolution {
  const scanned = sanitizeBarcodeScan(raw);
  if (!scanned) return { kind: "empty" };

  const item = findCatalogBySkuOrBarcode(items, scanned);
  if (item) return { kind: "matched", item, scanned };

  if (isVendorBarcode(scanned)) {
    return { kind: "unlinked_barcode", scanned };
  }

  return { kind: "unknown_sku", scanned };
}

/** Heuristic: keystrokes arriving faster than this are scanner-like. */
export const SCANNER_INTER_KEY_MS = 45;
