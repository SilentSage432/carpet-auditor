/**
 * ENGINE-PROD-004 — Bulk aisle → location relevance for Seasonal Context.
 * Writes existing operational_context_location_relevance rows for every
 * eligible surface in a department aisle. No new seasonal-aisle table.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAisle } from "./aisle";
import {
  setOperationalContextLocationRelevance,
  type OperationalContextRelevance,
} from "./operational-context";

export type AisleSeasonalRelevanceResult = {
  context_id: string;
  aisle: string;
  department_id: string;
  relevance: OperationalContextRelevance | "UNSET";
  surfaces_written: number;
  reason: string;
};

export async function setAisleSeasonalLocationRelevance(
  supabase: SupabaseClient,
  input: {
    context_id: string;
    store_id: string;
    department_id: string;
    aisle: string;
    relevance: OperationalContextRelevance | "UNSET";
    declared_by?: string | null;
  }
): Promise<AisleSeasonalRelevanceResult> {
  const contextId = String(input.context_id ?? "").trim();
  const storeId = String(input.store_id ?? "").trim();
  const departmentId = String(input.department_id ?? "").trim();
  const aisle = normalizeAisle(input.aisle);
  if (!contextId || !storeId || !departmentId || !aisle) {
    throw new Error("context_id, store_id, department_id, and aisle are required");
  }

  const { data: locs, error } = await supabase
    .from("store_locations")
    .select("id, aisle, location_type, is_active, department_id")
    .eq("department_id", departmentId)
    .eq("is_active", true);

  if (error) throw new Error(error.message);

  const targetIds = (locs ?? [])
    .filter((loc) => {
      if ((loc.location_type ?? "STANDARD") === "SHOWROOM_STACKOUT") return false;
      return normalizeAisle(loc.aisle) === aisle;
    })
    .map((loc) => String(loc.id));

  if (targetIds.length === 0) {
    return {
      context_id: contextId,
      aisle,
      department_id: departmentId,
      relevance: input.relevance,
      surfaces_written: 0,
      reason: `No eligible surfaces in aisle ${aisle}.`,
    };
  }

  const relevanceValue =
    input.relevance === "UNSET" ? null : input.relevance;

  let written = 0;
  for (const locationId of targetIds) {
    const result = await setOperationalContextLocationRelevance(supabase, {
      context_id: contextId,
      store_id: storeId,
      location_id: locationId,
      relevance: relevanceValue,
      declared_by: input.declared_by ?? null,
    });
    if (!result.ok) {
      throw new Error(result.message || "Could not save aisle seasonal relevance");
    }
    written += 1;
  }

  return {
    context_id: contextId,
    aisle,
    department_id: departmentId,
    relevance: input.relevance,
    surfaces_written: written,
    reason:
      input.relevance === "UNSET"
        ? `Cleared seasonal relevance for aisle ${aisle} (${written} surfaces).`
        : `Aisle ${aisle} set to ${input.relevance} for this season (${written} surfaces).`,
  };
}
