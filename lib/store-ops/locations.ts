/**
 * Bulk store location generation + listing helpers (server).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BulkGenerateInput,
  StoreLocation,
  StoreLocationType,
} from "./types";

export function buildBulkLocationRows(input: BulkGenerateInput): Array<{
  department_id: string;
  aisle: number;
  bay: number;
  type: StoreLocationType;
  status: "PENDING";
  cycle_number: number;
  is_active: boolean;
}> {
  const { department_id, aisle, start_bay, end_bay, types } = input;
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

  const rows: Array<{
    department_id: string;
    aisle: number;
    bay: number;
    type: StoreLocationType;
    status: "PENDING";
    cycle_number: number;
    is_active: boolean;
  }> = [];

  for (let bay = start_bay; bay <= end_bay; bay += 1) {
    for (const type of types) {
      rows.push({
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
  input: BulkGenerateInput
): Promise<StoreLocation[]> {
  const rows = buildBulkLocationRows(input);
  const { data, error } = await supabase
    .from("store_locations")
    .upsert(rows, {
      onConflict: "department_id,aisle,bay,type",
      ignoreDuplicates: true,
    })
    .select("*");

  if (error) throw new Error(error.message);
  return (data ?? []) as StoreLocation[];
}
