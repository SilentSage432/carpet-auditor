/**
 * RD-2 — Floor Command Map aisle → bay navigation helpers.
 *
 * Presentation only. Physical bay = (department_id, aisle, bay).
 * Does not invent aisle adjacency, sections, or department geography.
 */

import { compareAisles, normalizeAisle } from "./aisle";
import type { Department, StoreLocation } from "./types";

export type MapBayPair = {
  bay: number;
  selling: StoreLocation | null;
  topstock: StoreLocation | null;
};

export type MapAisleEntry = {
  /** Stable key: departmentId:aisle */
  key: string;
  aisle: string;
  departmentId: string;
  departmentName: string;
  /** True when the same aisle code appears under more than one department. */
  aisleCodeCollides: boolean;
  bays: MapBayPair[];
  physicalBayCount: number;
  activeBayCount: number;
  inactiveBayCount: number;
};

export function buildMapBayPairs(locs: StoreLocation[]): MapBayPair[] {
  const byBay = new Map<number, MapBayPair>();
  for (const loc of locs) {
    let pair = byBay.get(loc.bay);
    if (!pair) {
      pair = { bay: loc.bay, selling: null, topstock: null };
      byBay.set(loc.bay, pair);
    }
    if (loc.type === "SELLING") pair.selling = loc;
    else if (loc.type === "TOPSTOCK") pair.topstock = loc;
  }
  return [...byBay.values()].sort((a, b) => a.bay - b.bay);
}

/** A physical bay is active when any mapped surface is active. */
export function isMapBayPairActive(
  pair: MapBayPair,
  activeOverlay?: Record<string, boolean>
): boolean {
  const faces = [pair.selling, pair.topstock].filter(
    (loc): loc is StoreLocation => Boolean(loc)
  );
  if (faces.length === 0) return false;
  return faces.some((loc) => activeOverlay?.[loc.id] ?? loc.is_active);
}

/**
 * Compose aisle-first index from location rows.
 * Groups by (department_id, aisle) — never invents cross-aisle structure.
 */
export function composeMapAisleIndex(input: {
  locations: StoreLocation[];
  departments: Department[];
  showRetired?: boolean;
  activeOverlay?: Record<string, boolean>;
}): MapAisleEntry[] {
  const showRetired = Boolean(input.showRetired);
  const nameById = new Map(input.departments.map((d) => [d.id, d.name]));

  const byKey = new Map<string, StoreLocation[]>();
  for (const loc of input.locations) {
    const aisle = normalizeAisle(loc.aisle);
    if (!aisle) continue;
    const key = `${loc.department_id}:${aisle}`;
    const list = byKey.get(key) ?? [];
    list.push(loc);
    byKey.set(key, list);
  }

  const deptsByAisleCode = new Map<string, Set<string>>();
  for (const [key] of byKey) {
    const aisle = key.slice(key.indexOf(":") + 1);
    const departmentId = key.slice(0, key.indexOf(":"));
    const set = deptsByAisleCode.get(aisle) ?? new Set<string>();
    set.add(departmentId);
    deptsByAisleCode.set(aisle, set);
  }

  const entries: MapAisleEntry[] = [];
  for (const [key, locs] of byKey) {
    const sample = locs[0];
    if (!sample) continue;
    const aisle = normalizeAisle(sample.aisle);
    const allBays = buildMapBayPairs(locs);
    let activeBayCount = 0;
    let inactiveBayCount = 0;
    for (const pair of allBays) {
      if (isMapBayPairActive(pair, input.activeOverlay)) activeBayCount += 1;
      else inactiveBayCount += 1;
    }
    if (!showRetired && activeBayCount === 0) continue;

    const displayBays = showRetired
      ? allBays
      : allBays.filter((pair) =>
          isMapBayPairActive(pair, input.activeOverlay)
        );

    const deptSet = deptsByAisleCode.get(aisle);
    entries.push({
      key,
      aisle,
      departmentId: sample.department_id,
      departmentName: nameById.get(sample.department_id) ?? "Unknown",
      aisleCodeCollides: Boolean(deptSet && deptSet.size > 1),
      bays: displayBays,
      physicalBayCount: displayBays.length,
      activeBayCount,
      inactiveBayCount,
    });
  }

  return entries.sort((a, b) => {
    const aisleCmp = compareAisles(a.aisle, b.aisle);
    if (aisleCmp !== 0) return aisleCmp;
    return a.departmentName.localeCompare(b.departmentName);
  });
}

export function formatMapAisleLabel(
  entry: Pick<
    MapAisleEntry,
    "aisle" | "departmentName" | "aisleCodeCollides"
  >
): string {
  if (entry.aisleCodeCollides) {
    return `Aisle ${entry.aisle} · ${entry.departmentName}`;
  }
  return `Aisle ${entry.aisle}`;
}

export function filterAisleIndexByQuery(
  entries: MapAisleEntry[],
  query: string
): MapAisleEntry[] {
  const q = normalizeAisle(query);
  if (!q) return entries;
  return entries.filter(
    (entry) =>
      normalizeAisle(entry.aisle).includes(q) ||
      entry.departmentName.toUpperCase().includes(q)
  );
}
