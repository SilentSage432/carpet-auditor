/**
 * Bulk store location generation + listing helpers (server).
 */

import { isValidAisle, normalizeAisle } from "./aisle";
import {
  expandBayNumbers,
  parseBayNumberingPattern,
} from "./bay-pattern";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readableError } from "./errors";
import type {
  BulkGenerateInput,
  StoreLocation,
  StoreLocationType,
} from "./types";

/** Unique key on public.store_locations — Selling + Topstock per aisle/bay. */
export const STORE_LOCATIONS_ON_CONFLICT =
  "department_id,aisle,bay,type" as const;

export function buildBulkLocationRows(
  input: BulkGenerateInput & { store_id: string }
): Array<{
  store_id: string;
  department_id: string;
  aisle: string;
  bay: number;
  type: StoreLocationType;
  status: "PENDING";
  cycle_number: number;
  is_active: true;
}> {
  const { store_id, department_id, start_bay, end_bay, types } = input;
  const aisle = normalizeAisle(input.aisle);
  if (!store_id) throw new Error("store_id is required");
  if (!department_id) throw new Error("department_id is required");
  if (!isValidAisle(aisle)) {
    throw new Error("aisle is required (alphanumeric code, e.g. BW, 12, A1)");
  }

  const uniqueTypes = Array.from(
    new Set(
      types.filter(
        (t): t is StoreLocationType => t === "SELLING" || t === "TOPSTOCK"
      )
    )
  );
  if (!uniqueTypes.length) {
    throw new Error("Select at least one location type");
  }

  const bays = expandBayNumbers(
    start_bay,
    end_bay,
    parseBayNumberingPattern(input.bay_pattern)
  );

  const rows: Array<{
    store_id: string;
    department_id: string;
    aisle: string;
    bay: number;
    type: StoreLocationType;
    status: "PENDING";
    cycle_number: number;
    is_active: true;
  }> = [];

  for (const bay of bays) {
    for (const type of uniqueTypes) {
      rows.push({
        store_id,
        department_id,
        aisle,
        bay,
        type,
        status: "PENDING",
        cycle_number: 1,
        is_active: true,
      });
    }
  }
  return rows;
}

export async function bulkInsertLocations(
  supabase: SupabaseClient,
  input: BulkGenerateInput & { store_id: string }
): Promise<StoreLocation[]> {
  try {
    const payload = buildBulkLocationRows(input);
    const { data, error } = await supabase
      .from("store_locations")
      .upsert(payload, { onConflict: STORE_LOCATIONS_ON_CONFLICT })
      .select("*");

    if (error) {
      throw new Error(readableError(error, "Bulk location upsert failed"));
    }
    return (data ?? []) as StoreLocation[];
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(readableError(error, "Bulk location upsert failed"));
  }
}
