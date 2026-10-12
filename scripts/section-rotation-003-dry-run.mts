/**
 * DEPTSYNC-SECTION-ROTATION-003 — isolated local dry-run harness.
 * Reads a sanitized production-derived JSON snapshot (no writes).
 *
 * Usage:
 *   npx tsx scripts/section-rotation-003-dry-run.mts /tmp/sr003-snapshot/prod-sanitized.json
 */

import { readFileSync } from "node:fs";
import {
  buildPreviewCapacityCaps,
  composeSectionAwareWeeklyPreview,
  selectBaysWithSectionPreference,
  type SectionAwareBayRef,
  type SectionAwarePriorityTier,
} from "../lib/store-ops/section-aware-rotation";
import type { BaySectionLookup } from "../lib/store-ops/operational-sections";
import { physicalBayKey } from "../lib/store-ops/physical-bay";
import type { ShiftRosterMember } from "../lib/store-ops/weekly-rotations";

type Snapshot = {
  associates: Array<{
    id: string;
    name: string;
    role: string;
    home_dept: string;
  }>;
  sections: Array<{
    id: string;
    name: string;
    steward_id: string | null;
    steward_name: string | null;
    department_id: string;
  }>;
  members: Array<{
    section_id: string;
    department_id: string;
    aisle: string;
    bay: number;
  }>;
  active_physical_bays: Array<{
    department_id: string;
    aisle: string;
    bay: number;
    priority_override: boolean;
    velocity_tier: string | null;
    carried_over: boolean;
    location_type: string;
  }>;
  w42_shift_rows: number;
  w41_eligible_summary: Array<{ name: string; on_duty_with_times: number }>;
};

function buildBaySectionMap(snap: Snapshot): Map<string, BaySectionLookup> {
  const sectionById = new Map(snap.sections.map((s) => [s.id, s]));
  const map = new Map<string, BaySectionLookup>();
  for (const m of snap.members) {
    const section = sectionById.get(m.section_id);
    if (!section) continue;
    const key = physicalBayKey({
      department_id: m.department_id,
      aisle: m.aisle,
      bay: m.bay,
    });
    map.set(key, {
      section_id: section.id,
      section_name: section.name,
      department_id: m.department_id,
      primary_owner_specialist_id: section.steward_id,
      primary_owner_name: section.steward_name,
      is_active: true,
    });
  }
  return map;
}

function tierForBay(
  bay: Snapshot["active_physical_bays"][number]
): SectionAwarePriorityTier {
  if (bay.carried_over) return "carry";
  if (bay.priority_override) return "high";
  if (
    bay.velocity_tier === "high" ||
    bay.velocity_tier === "critical_hotspot"
  ) {
    return "velocity";
  }
  return "aging";
}

function bayRefsFromSnap(snap: Snapshot): SectionAwareBayRef[] {
  return snap.active_physical_bays.map((bay) => ({
    department_id: bay.department_id,
    aisle: bay.aisle,
    bay: bay.bay,
    rotationId: `rot:${bay.department_id}:${bay.aisle}:${bay.bay}`,
    riskScore: 0,
    priority_tier: tierForBay(bay),
  }));
}

/** Coverage-first draw approximation: stable numeric aisle/bay order (no section stage bias). */
function selectCoverageFirst(
  bays: SectionAwareBayRef[],
  drawCount: number
): SectionAwareBayRef[] {
  const sorted = [...bays].sort((a, b) => {
    const aisleCmp = String(a.aisle).localeCompare(String(b.aisle), undefined, {
      numeric: true,
    });
    if (aisleCmp !== 0) return aisleCmp;
    return Number(a.bay) - Number(b.bay);
  });
  const seen = new Set<string>();
  const out: SectionAwareBayRef[] = [];
  for (const bay of sorted) {
    const key = `${bay.department_id}|${bay.aisle}|${bay.bay}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(bay);
    if (out.length >= drawCount) break;
  }
  return out;
}

function runScenario(
  label: string,
  snap: Snapshot,
  eligibleNames: string[],
  drawCount: number,
  stageMode: "section_preference" | "coverage_first"
) {
  const baySectionByKey = buildBaySectionMap(snap);
  const eligible = snap.associates.filter((a) =>
    eligibleNames.includes(a.name)
  );
  const eligibleIds = eligible.map((a) => a.id);
  const members: ShiftRosterMember[] = eligible.map((a) => ({
    specialist_id: a.id,
    specialist_name: a.name,
    hours: 40,
    active: true,
  }));

  const capacity = buildPreviewCapacityCaps({
    eligibleSpecialistIds: eligibleIds,
    ownedBySpecialist: {},
    ownedTotal: 0,
  });

  const allRefs = bayRefsFromSnap(snap);
  const byTier = new Map<SectionAwarePriorityTier, SectionAwareBayRef[]>();
  for (const bay of allRefs) {
    const tier = (bay.priority_tier ?? "aging") as SectionAwarePriorityTier;
    const list = byTier.get(tier) ?? [];
    list.push(bay);
    byTier.set(tier, list);
  }
  const tiers = (
    ["carry", "seasonal", "high", "velocity", "aging"] as const
  ).map((tier) => ({
    tier,
    candidates: byTier.get(tier) ?? [],
  }));

  const selected: SectionAwareBayRef[] =
    stageMode === "section_preference"
      ? selectBaysWithSectionPreference(
          tiers,
          drawCount,
          baySectionByKey,
          eligibleIds
        ).map((b) => ({
          department_id: b.department_id,
          aisle: b.aisle,
          bay: b.bay,
          rotationId:
            b.rotationId ?? `rot:${b.department_id}:${b.aisle}:${b.bay}`,
          riskScore: b.riskScore ?? 0,
          priority_tier: (b as SectionAwareBayRef).priority_tier ?? "aging",
          location_id: b.location_id,
        }))
      : selectCoverageFirst(allRefs, drawCount);

  const preview = composeSectionAwareWeeklyPreview({
    store_number: "2587",
    week_label: "2026-W42",
    bays: selected,
    members,
    baySectionByKey,
    ownedRotationIds: [],
    capacity,
  });

  const byPerson = new Map<
    string,
    {
      name: string;
      total: number;
      steward_match: number;
      section_coverage: number;
      coverage_fallback: number;
      outside: Array<{ aisle: string; bay: number; preference: string; section: string | null }>;
      inside: Array<{ aisle: string; bay: number; preference: string; section: string | null }>;
    }
  >();
  for (const a of eligible) {
    byPerson.set(a.id, {
      name: a.name,
      total: 0,
      steward_match: 0,
      section_coverage: 0,
      coverage_fallback: 0,
      outside: [],
      inside: [],
    });
  }
  for (const item of preview.items) {
    const row = byPerson.get(item.specialist_id);
    if (!row) continue;
    row.total += 1;
    if (item.preference === "steward_match") row.steward_match += 1;
    if (item.preference === "section_coverage") row.section_coverage += 1;
    if (item.preference === "coverage_fallback") row.coverage_fallback += 1;
    const entry = {
      aisle: String(item.aisle),
      bay: Number(item.bay),
      preference: item.preference,
      section: item.section_name,
    };
    if (item.preference === "steward_match") row.inside.push(entry);
    else row.outside.push(entry);
  }

  console.log(`\n=== ${label} ===`);
  console.log(
    JSON.stringify(
      {
        eligible: eligible.map((a) => a.name),
        shared_target: capacity.shared_target,
        remaining_shared: capacity.remaining_shared,
        draw_requested: drawCount,
        selected: selected.length,
        proposed: preview.items.length,
        steward_match_count: preview.steward_match_count,
        coverage_fallback_count: preview.coverage_fallback_count,
        by_person: [...byPerson.values()],
        proposed_rows: preview.items.map((i) => ({
          name: i.specialist_name,
          aisle: i.aisle,
          bay: i.bay,
          preference: i.preference,
          section: i.section_name,
          steward: i.steward_name,
          tier: i.priority_tier,
        })),
      },
      null,
      2
    )
  );
}

const path = process.argv[2];
if (!path) {
  console.error("Usage: npx tsx scripts/section-rotation-003-dry-run.mts <snapshot.json>");
  process.exit(1);
}
const snap = JSON.parse(readFileSync(path, "utf8")) as Snapshot;

console.log(
  JSON.stringify(
    {
      associates: snap.associates.map((a) => a.name),
      sections: snap.sections.map((s) => ({
        name: s.name,
        steward: s.steward_name,
      })),
      member_count: snap.members.length,
      active_physical_bays: snap.active_physical_bays.length,
      w42_shift_rows: snap.w42_shift_rows,
      w41_eligible_summary: snap.w41_eligible_summary,
    },
    null,
    2
  )
);

// A) Actual W42 eligibility (no schedules → 0 eligible)
runScenario("ACTUAL_W42_NO_SCHEDULES", snap, [], 12, "coverage_first");

// B) Diagnostic: W41 labor pattern + coverage-first stage (closest to current Sunday stage)
runScenario(
  "DIAGNOSTIC_W41_PATTERN_COVERAGE_STAGE",
  snap,
  ["Tracy", "Tyson"],
  6,
  "coverage_first"
);

// C) Diagnostic: all four eligible + coverage-first stage + section-aware assign
runScenario(
  "DIAGNOSTIC_ALL_FOUR_COVERAGE_STAGE",
  snap,
  ["Nate", "Nick", "Tracy", "Tyson"],
  12,
  "coverage_first"
);

// D) Diagnostic: all four + section-preference stage (not wired to Sunday; shows stage bias)
runScenario(
  "DIAGNOSTIC_ALL_FOUR_SECTION_STAGE",
  snap,
  ["Nate", "Nick", "Tracy", "Tyson"],
  12,
  "section_preference"
);
