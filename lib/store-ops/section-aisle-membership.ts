/**
 * DEPTSYNC-SECTION-UX-001 — aisle-first Operational Section membership compose.
 *
 * Expands selected aisles into explicit physical-bay membership refs.
 * Does not invent undocumented bays, silently move conflicted bays between
 * sections, or auto-include future topology.
 *
 * Persistence remains operational_section_members (bay-keyed).
 */

import { normalizeAisle } from "./aisle";
import {
  composeMapAisleIndex,
  formatMapAisleLabel,
  type MapAisleEntry,
} from "./map-aisle-navigation";
import {
  sectionBayKey,
  type OperationalSectionBayRef,
} from "./operational-sections";
import type { Department, StoreLocation } from "./types";

export type SectionAisleConflict = {
  aisle_key: string;
  aisle_label: string;
  bay: number;
  physical_key: string;
  claimed_by_section_id: string;
  claimed_by_section_name: string | null;
};

export type SectionAisleSelectionRow = {
  aisle_key: string;
  aisle_label: string;
  aisle: string;
  department_id: string;
  active_bay_count: number;
  /** Active bays that can be added (not claimed elsewhere, not already members). */
  available_bay_count: number;
  /** Active bays claimed by another active section. */
  conflict_bay_count: number;
  /** Active bays already in the target section. */
  already_member_count: number;
  /** True when the aisle has no active documented bays. */
  zero_active_bays: boolean;
  selected: boolean;
};

export type SectionAisleMembershipPreview = {
  selected_aisle_keys: string[];
  selected_aisle_labels: string[];
  /** Explicit bay refs that would be added (conflicts excluded). */
  bays_to_add: OperationalSectionBayRef[];
  total_bays_to_add: number;
  conflicts: SectionAisleConflict[];
  zero_active_aisles: string[];
  /** Aisles selected that only partially contribute (some conflicts / already). */
  partial_aisles: string[];
  fingerprint: string;
  note: string;
};

export type ClaimedBayInfo = {
  section_id: string;
  section_name: string | null;
};

function aisleLabel(entry: MapAisleEntry): string {
  return formatMapAisleLabel(entry);
}

export function buildSectionAisleMembershipFingerprint(input: {
  selected_aisle_keys: readonly string[];
  bay_keys: readonly string[];
  claimed_keys: readonly string[];
  existing_member_keys: readonly string[];
}): string {
  return [
    [...input.selected_aisle_keys].map(String).sort().join(","),
    [...input.bay_keys].map(String).sort().join(","),
    [...input.claimed_keys].map(String).sort().join(","),
    [...input.existing_member_keys].map(String).sort().join(","),
  ].join("::");
}

/**
 * Expand one aisle entry into active physical-bay membership refs.
 * Retired / inactive bays are omitted (composeMapAisleIndex already filters
 * when showRetired=false).
 */
export function expandAisleToActiveBayRefs(
  aisle: MapAisleEntry
): OperationalSectionBayRef[] {
  const department_id = String(aisle.departmentId ?? "").trim();
  const aisleCode = normalizeAisle(aisle.aisle);
  if (!department_id || !aisleCode) return [];
  return aisle.bays.map((pair) => ({
    department_id,
    aisle: aisleCode,
    bay: Number(pair.bay) || 0,
  }));
}

export function composeSectionAisleSelectionRows(input: {
  aisleIndex: readonly MapAisleEntry[];
  selectedAisleKeys: ReadonlySet<string> | readonly string[];
  /** physicalBayKey → claiming section (other active sections only). */
  claimedByKey: ReadonlyMap<string, ClaimedBayInfo>;
  /** Keys already in the section being edited/created. */
  existingMemberKeys?: ReadonlySet<string> | readonly string[];
}): SectionAisleSelectionRow[] {
  const selected = new Set(
    [...input.selectedAisleKeys].map(String).filter(Boolean)
  );
  const existing = new Set(
    [...(input.existingMemberKeys ?? [])].map(String).filter(Boolean)
  );

  return input.aisleIndex.map((aisle) => {
    const refs = expandAisleToActiveBayRefs(aisle);
    let available = 0;
    let conflict = 0;
    let already = 0;
    for (const ref of refs) {
      const key = sectionBayKey(ref);
      if (existing.has(key)) {
        already += 1;
        continue;
      }
      if (input.claimedByKey.has(key)) {
        conflict += 1;
        continue;
      }
      available += 1;
    }
    return {
      aisle_key: aisle.key,
      aisle_label: aisleLabel(aisle),
      aisle: aisle.aisle,
      department_id: aisle.departmentId,
      active_bay_count: aisle.activeBayCount,
      available_bay_count: available,
      conflict_bay_count: conflict,
      already_member_count: already,
      zero_active_bays: aisle.activeBayCount === 0,
      selected: selected.has(aisle.key),
    };
  });
}

/**
 * Build a save preview for selected aisles.
 * Conflicted bays are listed but NOT included in bays_to_add
 * (no silent reassignment).
 */
export function composeSectionAisleMembershipPreview(input: {
  aisleIndex: readonly MapAisleEntry[];
  selectedAisleKeys: readonly string[];
  claimedByKey: ReadonlyMap<string, ClaimedBayInfo>;
  existingMemberKeys?: ReadonlySet<string> | readonly string[];
}): SectionAisleMembershipPreview {
  const selectedKeys = [
    ...new Set(input.selectedAisleKeys.map(String).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
  const existing = new Set(
    [...(input.existingMemberKeys ?? [])].map(String).filter(Boolean)
  );
  const byKey = new Map(input.aisleIndex.map((a) => [a.key, a] as const));

  const bays_to_add: OperationalSectionBayRef[] = [];
  const conflicts: SectionAisleConflict[] = [];
  const zero_active_aisles: string[] = [];
  const partial_aisles: string[] = [];
  const selected_aisle_labels: string[] = [];
  const seenAdd = new Set<string>();

  for (const key of selectedKeys) {
    const aisle = byKey.get(key);
    if (!aisle) continue;
    const label = aisleLabel(aisle);
    selected_aisle_labels.push(label);
    if (aisle.activeBayCount === 0) {
      zero_active_aisles.push(label);
      continue;
    }

    const refs = expandAisleToActiveBayRefs(aisle);
    let available = 0;
    let conflictCount = 0;
    let already = 0;
    for (const ref of refs) {
      const physical = sectionBayKey(ref);
      if (existing.has(physical)) {
        already += 1;
        continue;
      }
      const claim = input.claimedByKey.get(physical);
      if (claim) {
        conflictCount += 1;
        conflicts.push({
          aisle_key: aisle.key,
          aisle_label: label,
          bay: ref.bay,
          physical_key: physical,
          claimed_by_section_id: claim.section_id,
          claimed_by_section_name: claim.section_name,
        });
        continue;
      }
      if (seenAdd.has(physical)) continue;
      seenAdd.add(physical);
      bays_to_add.push(ref);
      available += 1;
    }
    if (
      conflictCount > 0 ||
      already > 0 ||
      (available > 0 && available < aisle.activeBayCount)
    ) {
      if (conflictCount > 0 || (already > 0 && available > 0)) {
        partial_aisles.push(label);
      }
    }
  }

  conflicts.sort((a, b) => a.physical_key.localeCompare(b.physical_key));

  const fingerprint = buildSectionAisleMembershipFingerprint({
    selected_aisle_keys: selectedKeys,
    bay_keys: bays_to_add.map((b) => sectionBayKey(b)),
    claimed_keys: [...input.claimedByKey.keys()],
    existing_member_keys: [...existing],
  });

  return {
    selected_aisle_keys: selectedKeys,
    selected_aisle_labels,
    bays_to_add,
    total_bays_to_add: bays_to_add.length,
    conflicts,
    zero_active_aisles,
    partial_aisles: [...new Set(partial_aisles)].sort(),
    fingerprint,
    note:
      "Only currently documented active bays are included. Conflicted bays stay in their existing section. Future bays require a later confirmation.",
  };
}

export function assertSectionAislePreviewFresh(
  expectedFingerprint: string,
  recomputed: SectionAisleMembershipPreview
): { ok: true } | { ok: false; code: "STALE_SELECTION"; message: string } {
  if (
    String(expectedFingerprint ?? "").trim() &&
    expectedFingerprint === recomputed.fingerprint
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "STALE_SELECTION",
    message:
      "Aisle selection is outdated (topology, section membership, or conflicts changed). Refresh before saving.",
  };
}

/** Build aisle index scoped to one department's active topology. */
export function composeDepartmentAisleIndexForSections(input: {
  locations: StoreLocation[];
  departments: Department[];
  departmentId: string;
  /** REGISTRY-003 — include empty registered locations (zero membership). */
  registryAisles?: readonly {
    department_id: string;
    aisle: string;
    display_name?: string | null;
    is_active?: boolean;
  }[];
}): MapAisleEntry[] {
  const departmentId = String(input.departmentId ?? "").trim();
  return composeMapAisleIndex({
    locations: input.locations.filter(
      (loc) => !departmentId || loc.department_id === departmentId
    ),
    departments: input.departments,
    showRetired: false,
    registryAisles: (input.registryAisles ?? []).filter(
      (row) => !departmentId || row.department_id === departmentId
    ),
  });
}

/**
 * Index claims from other active sections (excludes the section being edited).
 */
export function indexClaimedBaysFromSections(input: {
  sections: ReadonlyArray<{
    id: string;
    name: string;
    is_active: boolean;
    members?: ReadonlyArray<{
      department_id: string;
      aisle: string;
      bay: number;
    }> | null;
  }>;
  excludeSectionId?: string | null;
}): Map<string, ClaimedBayInfo> {
  const exclude = String(input.excludeSectionId ?? "").trim();
  const map = new Map<string, ClaimedBayInfo>();
  for (const section of input.sections) {
    if (!section.is_active) continue;
    if (exclude && section.id === exclude) continue;
    for (const member of section.members ?? []) {
      const key = sectionBayKey(member);
      if (!map.has(key)) {
        map.set(key, {
          section_id: section.id,
          section_name: section.name ?? null,
        });
      }
    }
  }
  return map;
}

export function toggleAisleKeySelection(
  current: readonly string[],
  aisleKey: string
): string[] {
  const key = String(aisleKey ?? "").trim();
  if (!key) return [...current];
  const set = new Set(current.map(String));
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Count active bays that sit in aisle/zone codes already represented by a
 * section's membership but are not yet members (and not claimed elsewhere).
 *
 * Explicit inclusion only — never auto-adds. Operator re-selects those aisles
 * in SECTION-UX-001 to confirm.
 */
export function countDiscoverableBaysForSection(input: {
  aisleIndex: readonly MapAisleEntry[];
  sectionMembers: ReadonlyArray<{
    department_id: string;
    aisle: string;
    bay: number;
  }>;
  claimedByKey: ReadonlyMap<string, ClaimedBayInfo>;
}): {
  discoverable_count: number;
  aisle_labels: string[];
} {
  const memberKeys = new Set(
    input.sectionMembers.map((m) => sectionBayKey(m))
  );
  const memberAisleKeys = new Set(
    input.sectionMembers.map(
      (m) => `${String(m.department_id).trim()}:${normalizeAisle(m.aisle)}`
    )
  );
  const labels = new Set<string>();
  let discoverable_count = 0;
  for (const aisle of input.aisleIndex) {
    if (!memberAisleKeys.has(aisle.key)) continue;
    for (const ref of expandAisleToActiveBayRefs(aisle)) {
      const key = sectionBayKey(ref);
      if (memberKeys.has(key)) continue;
      if (input.claimedByKey.has(key)) continue;
      discoverable_count += 1;
      labels.add(aisleLabel(aisle));
    }
  }
  return {
    discoverable_count,
    aisle_labels: [...labels].sort((a, b) => a.localeCompare(b)),
  };
}
