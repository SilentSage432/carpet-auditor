/**
 * RD-2 — Floor Command Map aisle → bay navigation helpers.
 *
 * Presentation only. Physical bay = (department_id, aisle, bay).
 * Does not invent aisle adjacency, sections, or department geography.
 */

import {
  compareAisles,
  formatAisleDisplayLabel,
  normalizeAisle,
} from "./aisle";
import {
  normalizeStoreAisleCode,
  type StoreAisleRegistryInput,
} from "./store-aisles";
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
  /** Optional registry display_name (Carpet Wall); null → formatAisleDisplayLabel. */
  displayName: string | null;
  /** True when the same aisle code appears under more than one department. */
  aisleCodeCollides: boolean;
  /** True when this entry exists only in store_aisles (no bay rows). */
  registryOnly: boolean;
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
 * Compose aisle-first index from bay rows ∪ store_aisles registry.
 * Soft-join key: department_id + normalizeStoreAisleCode(aisle).
 * Never invents bay rows or cross-aisle structure.
 */
export function composeMapAisleIndex(input: {
  locations: StoreLocation[];
  departments: Department[];
  showRetired?: boolean;
  activeOverlay?: Record<string, boolean>;
  /** REGISTRY-003 — active (or retired when showRetired) aisle/zone shells. */
  registryAisles?: readonly StoreAisleRegistryInput[];
}): MapAisleEntry[] {
  const showRetired = Boolean(input.showRetired);
  const nameById = new Map(input.departments.map((d) => [d.id, d.name]));

  const byKey = new Map<string, StoreLocation[]>();
  for (const loc of input.locations) {
    const aisle = normalizeStoreAisleCode(loc.aisle);
    if (!aisle) continue;
    const key = `${loc.department_id}:${aisle}`;
    const list = byKey.get(key) ?? [];
    list.push(loc);
    byKey.set(key, list);
  }

  const registryByKey = new Map<string, StoreAisleRegistryInput>();
  for (const row of input.registryAisles ?? []) {
    const aisle = normalizeStoreAisleCode(row.aisle);
    const departmentId = String(row.department_id ?? "").trim();
    if (!aisle || !departmentId) continue;
    const active = row.is_active !== false;
    if (!showRetired && !active) continue;
    registryByKey.set(`${departmentId}:${aisle}`, row);
  }

  const deptsByAisleCode = new Map<string, Set<string>>();
  const touchCollision = (aisle: string, departmentId: string) => {
    const set = deptsByAisleCode.get(aisle) ?? new Set<string>();
    set.add(departmentId);
    deptsByAisleCode.set(aisle, set);
  };
  for (const [key] of byKey) {
    const colon = key.indexOf(":");
    touchCollision(key.slice(colon + 1), key.slice(0, colon));
  }
  for (const [key] of registryByKey) {
    const colon = key.indexOf(":");
    touchCollision(key.slice(colon + 1), key.slice(0, colon));
  }

  const entries: MapAisleEntry[] = [];
  const seen = new Set<string>();

  for (const [key, locs] of byKey) {
    const sample = locs[0];
    if (!sample) continue;
    const aisle = normalizeStoreAisleCode(sample.aisle);
    const registry = registryByKey.get(key);
    const allBays = buildMapBayPairs(locs);
    let activeBayCount = 0;
    let inactiveBayCount = 0;
    for (const pair of allBays) {
      if (isMapBayPairActive(pair, input.activeOverlay)) activeBayCount += 1;
      else inactiveBayCount += 1;
    }
    const registryActive = registry ? registry.is_active !== false : false;
    // Active view: keep aisles with active bays OR an active registry shell.
    if (!showRetired && activeBayCount === 0 && !registryActive) continue;

    const displayBays = showRetired
      ? allBays
      : allBays.filter((pair) =>
          isMapBayPairActive(pair, input.activeOverlay)
        );

    const deptSet = deptsByAisleCode.get(aisle);
    const displayName =
      registry?.display_name == null ||
      String(registry.display_name).trim() === ""
        ? null
        : String(registry.display_name).trim();
    entries.push({
      key,
      aisle,
      departmentId: sample.department_id,
      departmentName: nameById.get(sample.department_id) ?? "Unknown",
      displayName,
      aisleCodeCollides: Boolean(deptSet && deptSet.size > 1),
      registryOnly: false,
      bays: displayBays,
      physicalBayCount: displayBays.length,
      activeBayCount,
      inactiveBayCount,
    });
    seen.add(key);
  }

  for (const [key, registry] of registryByKey) {
    if (seen.has(key)) continue;
    const aisle = normalizeStoreAisleCode(registry.aisle);
    const departmentId = String(registry.department_id).trim();
    const deptSet = deptsByAisleCode.get(aisle);
    const displayName =
      registry.display_name == null ||
      String(registry.display_name).trim() === ""
        ? null
        : String(registry.display_name).trim();
    entries.push({
      key,
      aisle,
      departmentId,
      departmentName: nameById.get(departmentId) ?? "Unknown",
      displayName,
      aisleCodeCollides: Boolean(deptSet && deptSet.size > 1),
      registryOnly: true,
      bays: [],
      physicalBayCount: 0,
      activeBayCount: 0,
      inactiveBayCount: 0,
    });
  }

  return entries.sort((a, b) => {
    const aisleCmp = compareAisles(a.aisle, b.aisle);
    if (aisleCmp !== 0) return aisleCmp;
    return a.departmentName.localeCompare(b.departmentName);
  });
}

export function formatMapAisleLabel(
  entry: Pick<MapAisleEntry, "aisle" | "departmentName" | "aisleCodeCollides"> & {
    displayName?: string | null;
  }
): string {
  const named = entry.displayName?.trim();
  const base = named || formatAisleDisplayLabel(entry.aisle);
  if (entry.aisleCodeCollides) {
    return `${base} · ${entry.departmentName}`;
  }
  return base;
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
