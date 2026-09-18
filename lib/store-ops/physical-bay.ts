/**
 * Physical bay coverage identity — BAY-UNIT-002.
 *
 * Topology may store SELLING and TOPSTOCK as separate store_locations rows.
 * Rotation, allocation, and verification group them as one coverage obligation:
 * department_id + aisle + bay.
 *
 * Not persisted. No parent table. Map keeps surface rows.
 */

import { normalizeAisle } from "./aisle";
import { isEligibleRotationLocation } from "./location-eligibility";
import {
  isCarryOverDrawLocation,
  isManualHighPriorityLocation,
  pickSundayCarryOverFirst,
  pickSundayVelocityPrioritized,
} from "./rotation";
import { isSeasonalHighPhysicalBay } from "./seasonal-selection";
import { pickWeightedByPriorityAndAge } from "./week";
import type { StoreLocation, VelocityTier } from "./types";

export type PhysicalBayFields = {
  department_id: string;
  aisle: string | number;
  bay: number | string;
};

/** Deterministic coverage key. Does not include type or location UUID. */
export function physicalBayKey(loc: PhysicalBayFields): string {
  return `${loc.department_id}|${normalizeAisle(loc.aisle)}|${Number(loc.bay) || 0}`;
}

export type PhysicalBayGroup = {
  key: string;
  department_id: string;
  aisle: string;
  bay: number;
  surfaces: StoreLocation[];
};

export type PhysicalBaySelection = {
  key: string;
  representative: StoreLocation;
  assignIds: string[];
  surfaces: StoreLocation[];
};

export function isPhysicalBaySurface(
  loc: StoreLocation | null | undefined
): loc is StoreLocation {
  return isEligibleRotationLocation(loc);
}

export function groupLocationsByPhysicalBay(
  locations: StoreLocation[]
): PhysicalBayGroup[] {
  const map = new Map<string, PhysicalBayGroup>();
  for (const loc of locations) {
    if (!isPhysicalBaySurface(loc)) continue;
    const key = physicalBayKey(loc);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        department_id: loc.department_id,
        aisle: normalizeAisle(loc.aisle),
        bay: Number(loc.bay) || 0,
        surfaces: [],
      };
      map.set(key, group);
    }
    group.surfaces.push(loc);
  }
  return [...map.values()];
}

/**
 * Surfaces that still owe coverage. COMPLETED siblings stay complete until
 * a later physical-bay verification fans out; they do not consume a slot.
 * True carry-over remains owed. Manual High does not re-admit COMPLETED.
 */
export function owedPhysicalBaySurfaces(
  surfaces: StoreLocation[]
): StoreLocation[] {
  return surfaces.filter((loc) => {
    if (!isPhysicalBaySurface(loc)) return false;
    if (isCarryOverDrawLocation(loc)) return true;
    return String(loc.status ?? "").toUpperCase() !== "COMPLETED";
  });
}

/**
 * A physical bay is owed unless every eligible surface is COMPLETED and
 * none carries true carry-over evidence. Durable High is not owed evidence.
 */
export function physicalBayIsOwed(surfaces: StoreLocation[]): boolean {
  return owedPhysicalBaySurfaces(surfaces).length > 0;
}

/**
 * Weekly rotation needs one location_id. Prefer SELLING when that surface
 * still owes coverage; otherwise the remaining owed surface (stable id sort).
 * Inactive / SHOWROOM rows never represent the bay.
 */
export function representativePhysicalBayLocation(
  surfaces: StoreLocation[]
): StoreLocation | null {
  const owed = owedPhysicalBaySurfaces(surfaces);
  const pool = owed.length > 0 ? owed : surfaces.filter(isPhysicalBaySurface);
  if (pool.length === 0) return null;
  const selling = pool.filter((loc) => loc.type === "SELLING");
  const ranked = (selling.length > 0 ? selling : pool).slice();
  ranked.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return ranked[0] ?? null;
}

function worstVelocityTier(
  tiers: Array<VelocityTier | null | undefined>
): VelocityTier {
  if (tiers.includes("critical_hotspot")) return "critical_hotspot";
  if (tiers.includes("high")) return "high";
  return "standard";
}

/** Null (never) wins: either sibling never completed/serviced → bay is untreated. */
function oldestOrNever(
  values: Array<string | null | undefined>
): string | null {
  if (values.some((value) => !value)) return null;
  let oldest: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!oldest || Date.parse(value) < Date.parse(oldest)) oldest = value;
  }
  return oldest;
}

/**
 * Compose one pickable location so sibling urgency is not discarded.
 * Uses the representative row as the identity; overlays worst/oldest signals.
 */
export function composePhysicalBayCandidate(
  group: PhysicalBayGroup
): StoreLocation | null {
  const representative = representativePhysicalBayLocation(group.surfaces);
  if (!representative) return null;
  const eligible = group.surfaces.filter(isPhysicalBaySurface);
  const carry = eligible.filter(isCarryOverDrawLocation);
  const statuses = eligible.map((loc) => String(loc.status ?? "").toUpperCase());

  let status = representative.status;
  if (carry.length > 0 || statuses.includes("CARRIED_OVER")) {
    status = "CARRIED_OVER";
  } else if (statuses.includes("PENDING")) {
    status = "PENDING";
  } else if (statuses.includes("ASSIGNED")) {
    status = "ASSIGNED";
  }

  const decayDays = eligible
    .map((loc) => loc.custom_decay_days)
    .filter((n): n is number => n != null && Number.isFinite(Number(n)));

  const lastCarried =
    carry
      .map((loc) => loc.last_carried_over_at)
      .filter((stamp): stamp is string => Boolean(stamp))
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ??
    representative.last_carried_over_at ??
    null;

  return {
    ...representative,
    status,
    carried_over: carry.length > 0 || representative.carried_over === true,
    last_carried_over_at: lastCarried,
    priority_override: eligible.some((loc) => loc.priority_override === true),
    velocity_tier: worstVelocityTier(eligible.map((loc) => loc.velocity_tier)),
    manual_priority_count: Math.max(
      0,
      ...eligible.map((loc) => Number(loc.manual_priority_count) || 0)
    ),
    last_completed_at: oldestOrNever(
      eligible.map((loc) => loc.last_completed_at)
    ),
    last_serviced_at: oldestOrNever(
      eligible.map((loc) => loc.last_serviced_at)
    ),
    custom_decay_days:
      decayDays.length > 0 ? Math.min(...decayDays) : representative.custom_decay_days,
  };
}

/**
 * Group surfaces, compose sibling evidence, then draw N physical bays.
 * Existing carry-over / velocity pickers run on one candidate per physical bay.
 *
 * PRIORITY-UX-002 / ENGINE-PROD-004 Model A — earlier within universal cycle:
 * 1. True carry-over (incomplete-work debt; not manual High)
 * 2. Active seasonal HIGH (ephemeral; still-owed only)
 * 3. Durable manual High among remaining owed/eligible
 * 4. Velocity / cadence-due hot pool
 * 5. Remaining aging + manual_priority_count weights
 *
 * Manual High and seasonal keys never re-admit COMPLETED bays.
 * Seasonal keys never mutate rows.
 */
export type SelectPhysicalBayCoverageOptions = {
  /** Physical-bay keys (`dept|aisle|bay`) with active seasonal HIGH. */
  seasonalHighPhysicalKeys?: Iterable<string> | null;
};

export function selectPhysicalBayCoverage(
  pending: StoreLocation[],
  carried: StoreLocation[],
  drawCount: number,
  options?: SelectPhysicalBayCoverageOptions
): PhysicalBaySelection[] {
  const n = Math.max(0, drawCount);
  if (n === 0) return [];

  const seasonalKeys = new Set(
    [...(options?.seasonalHighPhysicalKeys ?? [])].map(String).filter(Boolean)
  );

  const byId = new Map<string, StoreLocation>();
  for (const loc of [...carried, ...pending]) {
    if (!isPhysicalBaySurface(loc)) continue;
    byId.set(loc.id, loc);
  }

  const groups = groupLocationsByPhysicalBay([...byId.values()]).filter((group) =>
    physicalBayIsOwed(group.surfaces)
  );

  const composed: Array<{ group: PhysicalBayGroup; loc: StoreLocation }> = [];
  for (const group of groups) {
    const loc = composePhysicalBayCandidate(group);
    if (loc) composed.push({ group, loc });
  }

  const carryLocs = composed
    .filter((row) => isCarryOverDrawLocation(row.loc))
    .map((row) => row.loc);
  const pendingLocs = composed
    .filter((row) => !isCarryOverDrawLocation(row.loc))
    .map((row) => row.loc);

  const carryPick = pickSundayCarryOverFirst(carryLocs, n);
  let remaining = n - carryPick.length;
  const pickedIds = new Set(carryPick.map((loc) => loc.id));

  const seasonalCandidates = pendingLocs.filter(
    (loc) =>
      !pickedIds.has(loc.id) &&
      isSeasonalHighPhysicalBay(loc, seasonalKeys)
  );
  const seasonalPick =
    remaining > 0 && seasonalCandidates.length > 0
      ? pickWeightedByPriorityAndAge(
          seasonalCandidates,
          Math.min(remaining, seasonalCandidates.length)
        )
      : [];
  for (const loc of seasonalPick) pickedIds.add(loc.id);
  remaining = n - carryPick.length - seasonalPick.length;

  const highCandidates = pendingLocs.filter(
    (loc) =>
      !pickedIds.has(loc.id) && isManualHighPriorityLocation(loc)
  );
  const highPick =
    remaining > 0 && highCandidates.length > 0
      ? pickWeightedByPriorityAndAge(
          highCandidates,
          Math.min(remaining, highCandidates.length)
        )
      : [];
  for (const loc of highPick) pickedIds.add(loc.id);
  remaining =
    n - carryPick.length - seasonalPick.length - highPick.length;

  const pendingPick =
    remaining > 0
      ? pickSundayVelocityPrioritized(pendingLocs, remaining, pickedIds)
      : [];

  const byComposedId = new Map(
    composed.map((row) => [row.loc.id, row.group] as const)
  );
  const seen = new Set<string>();
  const selected: PhysicalBaySelection[] = [];

  for (const loc of [...carryPick, ...seasonalPick, ...highPick, ...pendingPick]) {
    const group = byComposedId.get(loc.id);
    if (!group || seen.has(group.key)) continue;
    const representative = representativePhysicalBayLocation(group.surfaces);
    if (!representative) continue;
    seen.add(group.key);
    selected.push({
      key: group.key,
      representative,
      assignIds: owedPhysicalBaySurfaces(group.surfaces).map((surface) => surface.id),
      surfaces: group.surfaces,
    });
  }

  return selected;
}
