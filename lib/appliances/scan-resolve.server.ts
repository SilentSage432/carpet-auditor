/**
 * APP-UPC-001A — Server catalog resolve / teach against opaque fingerprints.
 */

import "server-only";

import {
  mapApplianceCatalogRow,
  type ApplianceCatalogPublicItem,
} from "@/lib/appliance-catalog";
import { fingerprintApplianceScanIdentifier } from "@/lib/appliances/scan-fingerprint.server";
import { canonicalApplianceScanIdentifier } from "@/lib/appliances/scan-identity";
import type { SupabaseClient } from "@supabase/supabase-js";

const IDENTIFIERS_TABLE = "appliance_catalog_identifiers";
const CATALOG_TABLE = "appliance_catalog";

export type ResolveScanResult =
  | {
      status: "matched";
      item: ApplianceCatalogPublicItem;
      scan_fingerprint: string;
    }
  | { status: "unknown"; scan_fingerprint: string }
  | { status: "empty" };

export async function resolveApplianceScanFingerprint(
  db: SupabaseClient,
  store: string,
  rawScanIdentifier: unknown
): Promise<ResolveScanResult> {
  const canonical = canonicalApplianceScanIdentifier(rawScanIdentifier);
  if (!canonical) return { status: "empty" };

  const scan_fingerprint = fingerprintApplianceScanIdentifier(canonical);

  const { data: idRow, error: idError } = await db
    .from(IDENTIFIERS_TABLE)
    .select("item_number, scan_fingerprint")
    .eq("store_number", store)
    .eq("scan_fingerprint", scan_fingerprint)
    .maybeSingle();

  if (idError) throw new Error(idError.message);
  if (!idRow) {
    return { status: "unknown", scan_fingerprint };
  }

  const item_number = String(
    (idRow as { item_number?: string }).item_number ?? ""
  ).trim();
  const { data: catalogRow, error: catalogError } = await db
    .from(CATALOG_TABLE)
    .select("*")
    .eq("store_number", store)
    .eq("item_number", item_number)
    .maybeSingle();

  if (catalogError) throw new Error(catalogError.message);
  if (!catalogRow) {
    return { status: "unknown", scan_fingerprint };
  }

  return {
    status: "matched",
    item: mapApplianceCatalogRow(catalogRow as Record<string, unknown>),
    scan_fingerprint,
  };
}

export async function teachApplianceScanFingerprint(
  db: SupabaseClient,
  input: {
    store: string;
    item_number: string;
    rawScanIdentifier: unknown;
  }
): Promise<{
  item: ApplianceCatalogPublicItem;
  scan_fingerprint: string;
  created: boolean;
}> {
  const item_number = String(input.item_number ?? "").trim();
  const canonical = canonicalApplianceScanIdentifier(input.rawScanIdentifier);
  if (!item_number) throw new Error("item_number is required");
  if (!canonical) throw new Error("scan_identifier is required");

  const scan_fingerprint = fingerprintApplianceScanIdentifier(canonical);

  const { data: catalogRow, error: catalogError } = await db
    .from(CATALOG_TABLE)
    .select("*")
    .eq("store_number", input.store)
    .eq("item_number", item_number)
    .maybeSingle();

  if (catalogError) throw new Error(catalogError.message);
  if (!catalogRow) {
    const err = new Error(`Item ${item_number} not found in catalog`);
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  const { data: existing, error: existingError } = await db
    .from(IDENTIFIERS_TABLE)
    .select("item_number, scan_fingerprint")
    .eq("store_number", input.store)
    .eq("scan_fingerprint", scan_fingerprint)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);

  if (existing) {
    const owner = String(
      (existing as { item_number?: string }).item_number ?? ""
    ).trim();
    if (owner !== item_number) {
      const err = new Error(
        `Scan identity is already linked to Item ${owner || "?"}. Clear or change that link first.`
      );
      (err as Error & { status?: number }).status = 409;
      throw err;
    }
    return {
      item: mapApplianceCatalogRow(catalogRow as Record<string, unknown>),
      scan_fingerprint,
      created: false,
    };
  }

  const now = new Date().toISOString();
  const { error: insertError } = await db.from(IDENTIFIERS_TABLE).insert({
    store_number: input.store,
    item_number,
    scan_fingerprint,
    created_at: now,
    updated_at: now,
  });

  if (insertError) {
    if (/duplicate|unique/i.test(insertError.message)) {
      const { data: raced } = await db
        .from(IDENTIFIERS_TABLE)
        .select("item_number")
        .eq("store_number", input.store)
        .eq("scan_fingerprint", scan_fingerprint)
        .maybeSingle();
      const owner = String(
        (raced as { item_number?: string } | null)?.item_number ?? ""
      ).trim();
      if (owner === item_number) {
        return {
          item: mapApplianceCatalogRow(catalogRow as Record<string, unknown>),
          scan_fingerprint,
          created: false,
        };
      }
      const err = new Error(
        `Scan identity is already linked to Item ${owner || "?"}.`
      );
      (err as Error & { status?: number }).status = 409;
      throw err;
    }
    throw new Error(insertError.message);
  }

  return {
    item: mapApplianceCatalogRow(catalogRow as Record<string, unknown>),
    scan_fingerprint,
    created: true,
  };
}
