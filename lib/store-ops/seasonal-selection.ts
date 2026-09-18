/**
 * ENGINE-PROD-004 — Declared seasonal influence on physical-bay selection.
 *
 * Active HIGH location relevance elevates still-owed physical bays earlier
 * within the universal coverage cycle (Model A). Ephemeral only — never
 * writes store_locations.priority_override.
 *
 * Sibling SELLING/TOPSTOCK relevance collapses to one physical-bay key.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { physicalBayKey } from "./physical-bay";
import {
  resolveLocationContextRelevanceForDate,
  type ResolvedLocationContextRelevance,
} from "./operational-context";
import type { StoreLocation } from "./types";

/** Relevance levels that elevate selection pressure (Model A). */
export const SEASONAL_SELECTION_LEVELS = new Set(["HIGH"]);

/**
 * Collapse active location relevance rows to distinct physical-bay keys.
 * Either sibling surface with HIGH is enough; both do not double-count.
 */
export function seasonalHighPhysicalBayKeys(input: {
  locations: Array<
    Pick<StoreLocation, "id" | "department_id" | "aisle" | "bay" | "type">
  >;
  relevanceItems: Array<
    Pick<ResolvedLocationContextRelevance, "location_id" | "location_relevance">
  >;
}): Set<string> {
  const byId = new Map(
    input.locations.map((loc) => [String(loc.id), loc] as const)
  );
  const keys = new Set<string>();
  for (const item of input.relevanceItems) {
    const level = String(item.location_relevance ?? "")
      .trim()
      .toUpperCase();
    if (!SEASONAL_SELECTION_LEVELS.has(level)) continue;
    const loc = byId.get(String(item.location_id));
    if (!loc) continue;
    keys.add(physicalBayKey(loc));
  }
  return keys;
}

/** True when a composed candidate's physical bay is seasonally elevated. */
export function isSeasonalHighPhysicalBay(
  loc: Pick<StoreLocation, "department_id" | "aisle" | "bay">,
  seasonalHighPhysicalKeys: Set<string> | Iterable<string> | null | undefined
): boolean {
  if (!seasonalHighPhysicalKeys) return false;
  const set =
    seasonalHighPhysicalKeys instanceof Set
      ? seasonalHighPhysicalKeys
      : new Set(seasonalHighPhysicalKeys);
  if (set.size === 0) return false;
  return set.has(physicalBayKey(loc));
}

/**
 * Resolve active seasonal HIGH physical-bay keys for a store on the
 * authoritative store-local operational date. Fail-soft: missing relation
 * or resolve errors → empty set (no seasonal pressure).
 */
export async function loadActiveSeasonalHighPhysicalKeys(
  supabase: SupabaseClient,
  input: {
    storeId: string | null | undefined;
    timeZone?: string | null;
    locations: Array<
      Pick<StoreLocation, "id" | "department_id" | "aisle" | "bay" | "type">
    >;
    instant?: Date;
  }
): Promise<Set<string>> {
  const storeId = String(input.storeId ?? "").trim();
  if (!storeId || input.locations.length === 0) return new Set();

  const resolved = await resolveLocationContextRelevanceForDate(supabase, {
    storeId,
    instant: input.instant ?? new Date(),
    timeZone: input.timeZone ?? "America/Denver",
    locationIds: input.locations.map((l) => l.id),
  });

  if (!resolved.ok || !("result" in resolved)) return new Set();

  return seasonalHighPhysicalBayKeys({
    locations: input.locations,
    relevanceItems: resolved.result.items,
  });
}
