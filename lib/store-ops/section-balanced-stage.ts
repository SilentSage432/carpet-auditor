/**
 * DEPTSYNC-ROTATION-AUTO-002 — section-balanced weekly stage selection.
 *
 * Pure composition: for each associate, select up to their remaining approved
 * capacity from bays inside their Operational Section only. Never fills from
 * another section. Preserves physical-bay priority order within each section
 * pool (carry → seasonal → manual High → velocity/aging).
 *
 * Does not persist, invent topology, change capacity, or enable auto-publish.
 */

import type { BaySectionLookup } from "./operational-sections";
import {
  physicalBayKey,
  selectPhysicalBayCoverage,
  type PhysicalBaySelection,
  type SelectPhysicalBayCoverageOptions,
} from "./physical-bay";
import type { StoreLocation } from "./types";

export type SectionBalancedStageSlot = {
  specialist_id: string;
  specialist_name?: string | null;
  /** Remaining approved capacity for this store-week (0–3). */
  capacity: number;
};

export type SectionBalancedStageShortfallCode =
  | "capacity_zero"
  | "no_section"
  | "insufficient_eligible_bays";

export type SectionBalancedStageShortfall = {
  specialist_id: string;
  specialist_name: string;
  requested: number;
  selected: number;
  unfilled: number;
  code: SectionBalancedStageShortfallCode;
  reason: string;
};

export type SectionBalancedStageResult = {
  mode: "section_balanced";
  selected: PhysicalBaySelection[];
  shortfalls: SectionBalancedStageShortfall[];
  /** Sum of per-associate requested capacities. */
  requested_total: number;
  selected_total: number;
};

function ownerIdForLocation(
  loc: StoreLocation,
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>
): string | null {
  const key = physicalBayKey(loc);
  const section = baySectionByKey.get(key);
  const owner = String(section?.primary_owner_specialist_id ?? "").trim();
  return owner || null;
}

function filterOwnedLocations(
  locations: StoreLocation[],
  specialistId: string,
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>
): StoreLocation[] {
  return locations.filter(
    (loc) => ownerIdForLocation(loc, baySectionByKey) === specialistId
  );
}

/**
 * Select staged physical bays so each associate receives at most their
 * remaining capacity from their own section — never cross-section fill.
 */
export function selectSectionBalancedPhysicalBayCoverage(input: {
  pending: StoreLocation[];
  carried: StoreLocation[];
  slots: readonly SectionBalancedStageSlot[];
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>;
  seasonalHighPhysicalKeys?: SelectPhysicalBayCoverageOptions["seasonalHighPhysicalKeys"];
}): SectionBalancedStageResult {
  const seasonalOpts: SelectPhysicalBayCoverageOptions = {
    seasonalHighPhysicalKeys: input.seasonalHighPhysicalKeys,
  };

  const slots = [...input.slots]
    .map((s) => ({
      specialist_id: String(s.specialist_id ?? "").trim(),
      specialist_name: String(s.specialist_name ?? "").trim() || "Associate",
      capacity: Math.max(0, Math.floor(Number(s.capacity) || 0)),
    }))
    .filter((s) => s.specialist_id)
    .sort((a, b) => a.specialist_id.localeCompare(b.specialist_id));

  const selected: PhysicalBaySelection[] = [];
  const seenKeys = new Set<string>();
  const shortfalls: SectionBalancedStageShortfall[] = [];
  let requestedTotal = 0;

  for (const slot of slots) {
    requestedTotal += slot.capacity;

    if (slot.capacity <= 0) {
      shortfalls.push({
        specialist_id: slot.specialist_id,
        specialist_name: slot.specialist_name,
        requested: 0,
        selected: 0,
        unfilled: 0,
        code: "capacity_zero",
        reason: `${slot.specialist_name}: approved remaining capacity is 0`,
      });
      continue;
    }

    const ownedPending = filterOwnedLocations(
      input.pending,
      slot.specialist_id,
      input.baySectionByKey
    ).filter((loc) => !seenKeys.has(physicalBayKey(loc)));
    const ownedCarried = filterOwnedLocations(
      input.carried,
      slot.specialist_id,
      input.baySectionByKey
    ).filter((loc) => !seenKeys.has(physicalBayKey(loc)));

    if (ownedPending.length === 0 && ownedCarried.length === 0) {
      shortfalls.push({
        specialist_id: slot.specialist_id,
        specialist_name: slot.specialist_name,
        requested: slot.capacity,
        selected: 0,
        unfilled: slot.capacity,
        code: "no_section",
        reason: `${slot.specialist_name}: no owed eligible bays in owned Operational Section(s) for capacity ${slot.capacity}`,
      });
      continue;
    }

    const picks = selectPhysicalBayCoverage(
      ownedPending,
      ownedCarried,
      slot.capacity,
      seasonalOpts
    ).filter((row) => !seenKeys.has(row.key));

    for (const row of picks) {
      seenKeys.add(row.key);
      selected.push(row);
    }

    if (picks.length < slot.capacity) {
      shortfalls.push({
        specialist_id: slot.specialist_id,
        specialist_name: slot.specialist_name,
        requested: slot.capacity,
        selected: picks.length,
        unfilled: slot.capacity - picks.length,
        code: "insufficient_eligible_bays",
        reason: `${slot.specialist_name}: only ${picks.length}/${slot.capacity} owed eligible bays inside owned section(s)`,
      });
    }
  }

  selected.sort((a, b) => a.key.localeCompare(b.key));

  return {
    mode: "section_balanced",
    selected,
    shortfalls: shortfalls.filter(
      (s) => s.code !== "capacity_zero" || s.requested > 0
    ),
    requested_total: requestedTotal,
    selected_total: selected.length,
  };
}

/**
 * Reproduce AUTO-001 W42 failure mode: flat draw of 11 with CSA concentration
 * cannot be fully owned under strict section caps (Nate 2). Pure diagnostic.
 */
export function explainFlatStageOwnershipGap(input: {
  stagedKeysByOwner: ReadonlyMap<string, readonly string[]>;
  approvedCapacityByOwner: ReadonlyMap<string, number>;
  ownerNames?: ReadonlyMap<string, string>;
}): {
  achievable_owned: number;
  approved_sum: number;
  unownable_staged: number;
  per_owner: Array<{
    specialist_id: string;
    name: string;
    approved: number;
    staged_in_section: number;
    achievable: number;
    leftover_staged: number;
    unused_capacity: number;
  }>;
} {
  const per_owner: Array<{
    specialist_id: string;
    name: string;
    approved: number;
    staged_in_section: number;
    achievable: number;
    leftover_staged: number;
    unused_capacity: number;
  }> = [];

  const ids = new Set([
    ...input.stagedKeysByOwner.keys(),
    ...input.approvedCapacityByOwner.keys(),
  ]);

  let achievable = 0;
  let approvedSum = 0;
  let unownable = 0;

  for (const id of [...ids].sort()) {
    const approved = Math.max(
      0,
      Math.floor(input.approvedCapacityByOwner.get(id) ?? 0)
    );
    const staged = input.stagedKeysByOwner.get(id)?.length ?? 0;
    const canOwn = Math.min(approved, staged);
    const leftover = Math.max(0, staged - approved);
    const unused = Math.max(0, approved - staged);
    approvedSum += approved;
    achievable += canOwn;
    unownable += leftover;
    per_owner.push({
      specialist_id: id,
      name: input.ownerNames?.get(id) ?? id,
      approved,
      staged_in_section: staged,
      achievable: canOwn,
      leftover_staged: leftover,
      unused_capacity: unused,
    });
  }

  return {
    achievable_owned: achievable,
    approved_sum: approvedSum,
    unownable_staged: unownable,
    per_owner,
  };
}
