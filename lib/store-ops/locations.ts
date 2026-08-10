/**
 * Bulk store location generation + listing helpers (server).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readableError } from "./errors";
import type {
  BulkGenerateInput,
  StoreLocation,
  StoreLocationType,
} from "./types";

/** Unique key on public.store_locations (multi-store migration). */
export const STORE_LOCATIONS_ON_CONFLICT = "department_id,aisle,bay" as const;

export function buildBulkLocationRows(
  input: BulkGenerateInput & { store_id: string }
): Array<{
  store_id: string;
  department_id: string;
  aisle: number;
  bay: number;
  type: StoreLocationType;
  status: "PENDING";
  cycle_number: number;
  is_active: true;
}> {
  const { store_id, department_id, aisle, start_bay, end_bay, types } = input;
  if (!store_id) throw new Error("store_id is required");
  if (!department_id) throw new Error("department_id is required");
  if (!Number.isFinite(aisle) || aisle < 0) {
    throw new Error("aisle must be a non-negative integer");
  }
  if (!Number.isFinite(start_bay) || !Number.isFinite(end_bay)) {
    throw new Error("start_bay and end_bay are required");
  }
  if (start_bay > end_bay) {
    throw new Error("start_bay must be ≤ end_bay");
  }
  if (!types.length) {
    throw new Error("Select at least one location type");
  }

  // Unique key is (department_id, aisle, bay) — one row per bay.
  const type: StoreLocationType = types.includes("SELLING")
    ? "SELLING"
    : types[0];

  const rows: Array<{
    store_id: string;
    department_id: string;
    aisle: number;
    bay: number;
    type: StoreLocationType;
    status: "PENDING";
    cycle_number: number;
    is_active: true;
  }> = [];

  for (let bay = start_bay; bay <= end_bay; bay += 1) {
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
      throw new Error(
        readableError(error, "Bulk location upsert failed")
      );
    }
    return (data ?? []) as StoreLocation[];
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(readableError(error, "Bulk location upsert failed"));
  }
}
