/**
 * ENGINE-PROD-004 — Priority + seasonal cadence (Model A: earlier within cycle).
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  composePhysicalBayCandidate,
  groupLocationsByPhysicalBay,
  physicalBayKey,
  selectPhysicalBayCoverage,
} from "./physical-bay";
import {
  seasonalHighPhysicalBayKeys,
  isSeasonalHighPhysicalBay,
} from "./seasonal-selection";
import { selectNextExtraPhysicalBay } from "./extra-bay-dispatch";
import { BASE_WEEKLY_BAY_QUOTA } from "./weekly-rotations";
import { resolveAutomaticWeeklyBayTarget } from "./week";
import { compareOperationalDates } from "./fiscal-calendar";
import type { StoreLocation } from "./types";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function loc(
  overrides: Partial<StoreLocation> & {
    id: string;
    aisle: string;
    bay: number;
  }
): StoreLocation {
  return {
    id: overrides.id,
    department_id: overrides.department_id ?? "dept-1",
    store_id: overrides.store_id ?? "store-1",
    store_number: overrides.store_number ?? "2587",
    aisle: overrides.aisle,
    bay: overrides.bay,
    type: overrides.type ?? "SELLING",
    location_type: overrides.location_type ?? "STANDARD",
    status: overrides.status ?? "PENDING",
    is_active: overrides.is_active ?? true,
    cycle_number: overrides.cycle_number ?? 1,
    velocity_tier: overrides.velocity_tier ?? "standard",
    priority_override: overrides.priority_override ?? false,
    manual_priority_count: overrides.manual_priority_count ?? 0,
    carried_over: overrides.carried_over ?? false,
    last_completed_at: overrides.last_completed_at ?? "2026-01-01T00:00:00Z",
    last_serviced_at: overrides.last_serviced_at ?? null,
    last_carried_over_at: overrides.last_carried_over_at ?? null,
    created_at: overrides.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-01-01T00:00:00Z",
  } as StoreLocation;
}

describe("ENGINE-PROD-004 cadence model A + laws", () => {
  it("base quota remains 3; seasonal does not inflate automatic target", () => {
    expect(BASE_WEEKLY_BAY_QUOTA).toBe(3);
    expect(resolveAutomaticWeeklyBayTarget(4)).toBe(12);
  });

  it("selector integrates seasonal HIGH without new engine / Gemini / schema", () => {
    const phys = readRepo("lib/store-ops/physical-bay.ts");
    const seasonal = readRepo("lib/store-ops/seasonal-selection.ts");
    expect(phys).toMatch(/seasonalHighPhysicalKeys/);
    expect(phys).toMatch(/Model A/);
    expect(seasonal).toMatch(/never[\s*]+writes store_locations\.priority_override/i);
    expect(seasonal).not.toMatch(/gemini|create table|rpc\(/i);
    expect(readRepo("lib/store-ops/extra-bay-dispatch.ts")).toMatch(
      /loadActiveSeasonalHighPhysicalKeys/
    );
    expect(readRepo("lib/store-ops/rotations.ts")).toMatch(
      /loadActiveSeasonalHighPhysicalKeys/
    );
  });
});

describe("ENGINE-PROD-004 manual bay priority (sibling semantics)", () => {
  it("composePhysicalBayCandidate ORs priority_override across siblings", () => {
    const group = groupLocationsByPhysicalBay([
      loc({
        id: "s",
        aisle: "41",
        bay: 1,
        type: "SELLING",
        priority_override: false,
      }),
      loc({
        id: "t",
        aisle: "41",
        bay: 1,
        type: "TOPSTOCK",
        priority_override: true,
      }),
    ])[0];
    const composed = composePhysicalBayCandidate(group);
    expect(composed?.priority_override).toBe(true);
  });

  it("priority_override enters carry bucket ahead of ordinary PENDING", () => {
    const pending = [
      loc({ id: "n1", aisle: "10", bay: 1, status: "PENDING" }),
      loc({ id: "n2", aisle: "10", bay: 2, status: "PENDING" }),
    ];
    const pinned = [
      loc({
        id: "p1",
        aisle: "41",
        bay: 9,
        status: "PENDING",
        priority_override: true,
      }),
    ];
    const selected = selectPhysicalBayCoverage(pending, pinned, 1);
    expect(selected).toHaveLength(1);
    expect(selected[0].key).toBe(
      physicalBayKey({ department_id: "dept-1", aisle: "41", bay: 9 })
    );
  });
});

describe("ENGINE-PROD-004 seasonal keys + sibling collapse", () => {
  it("SELLING+TOPSTOCK HIGH collapses to one physical key", () => {
    const locations = [
      loc({ id: "s", aisle: "40", bay: 1, type: "SELLING" }),
      loc({ id: "t", aisle: "40", bay: 1, type: "TOPSTOCK" }),
    ];
    const keys = seasonalHighPhysicalBayKeys({
      locations,
      relevanceItems: [
        { location_id: "s", location_relevance: "HIGH" },
        { location_id: "t", location_relevance: "HIGH" },
      ],
    });
    expect(keys.size).toBe(1);
    expect(
      isSeasonalHighPhysicalBay(locations[0], keys)
    ).toBe(true);
  });

  it("LOW/MEDIUM/NONE do not elevate selection", () => {
    const locations = [loc({ id: "s", aisle: "40", bay: 1 })];
    for (const level of ["LOW", "MEDIUM", "NONE"] as const) {
      const keys = seasonalHighPhysicalBayKeys({
        locations,
        relevanceItems: [{ location_id: "s", location_relevance: level }],
      });
      expect(keys.size).toBe(0);
    }
  });
});

describe("ENGINE-PROD-004 seasonal date window (inclusive)", () => {
  it("compareOperationalDates preserves closed interval semantics", () => {
    // start <= op <= end
    expect(compareOperationalDates("2026-11-01", "2026-11-01")).toBe(0);
    expect(compareOperationalDates("2026-12-26", "2026-12-26")).toBe(0);
    expect(compareOperationalDates("2026-10-31", "2026-11-01")).toBeLessThan(0);
    expect(compareOperationalDates("2026-12-27", "2026-12-26")).toBeGreaterThan(
      0
    );
  });
});

describe("ENGINE-PROD-004 seasonal selection pressure (Model A)", () => {
  it("active HIGH seasonal bay is selected before ordinary PENDING", () => {
    // Seed RNG via weighted picker — use many ordinary + one seasonal;
    // with drawCount=1 seasonal pool is filled first deterministically when
    // seasonalCandidates are non-empty before velocity.
    const ordinary = Array.from({ length: 8 }, (_, i) =>
      loc({
        id: `o${i}`,
        aisle: "10",
        bay: i + 1,
        status: "PENDING",
        last_completed_at: "2026-06-01T00:00:00Z",
      })
    );
    const seasonalBay = loc({
      id: "xmas",
      aisle: "40",
      bay: 1,
      status: "PENDING",
      last_completed_at: "2026-08-01T00:00:00Z", // newer = less aged
    });
    const key = physicalBayKey(seasonalBay);
    const selected = selectPhysicalBayCoverage(
      [...ordinary, seasonalBay],
      [],
      1,
      { seasonalHighPhysicalKeys: [key] }
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].key).toBe(key);
  });

  it("inactive season (empty keys) does not elevate the same bay", () => {
    const ordinary = loc({
      id: "o1",
      aisle: "10",
      bay: 1,
      last_completed_at: null, // never → strongest age weight
    });
    const seasonalBay = loc({
      id: "xmas",
      aisle: "40",
      bay: 1,
      last_completed_at: "2026-08-01T00:00:00Z",
    });
    // Without seasonal keys, never-touched ordinary wins age weight.
    const picks = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const selected = selectPhysicalBayCoverage(
        [ordinary, seasonalBay],
        [],
        1,
        { seasonalHighPhysicalKeys: [] }
      );
      picks.add(selected[0]?.key ?? "");
    }
    expect(picks.has(physicalBayKey(ordinary))).toBe(true);
  });

  it("true carryover still precedes seasonal HIGH", () => {
    const carry = loc({
      id: "c1",
      aisle: "12",
      bay: 1,
      status: "CARRIED_OVER",
      carried_over: true,
    });
    const seasonalBay = loc({ id: "xmas", aisle: "40", bay: 1 });
    const selected = selectPhysicalBayCoverage(
      [seasonalBay],
      [carry],
      1,
      {
        seasonalHighPhysicalKeys: [physicalBayKey(seasonalBay)],
      }
    );
    expect(selected[0].key).toBe(physicalBayKey(carry));
  });

  it("COMPLETED seasonal bay is not re-admitted (no Model B)", () => {
    const completedSeasonal = loc({
      id: "done",
      aisle: "40",
      bay: 1,
      status: "COMPLETED",
    });
    const ordinary = loc({ id: "o1", aisle: "10", bay: 1, status: "PENDING" });
    const selected = selectPhysicalBayCoverage(
      [ordinary],
      [completedSeasonal],
      1,
      {
        seasonalHighPhysicalKeys: [physicalBayKey(completedSeasonal)],
      }
    );
    expect(selected[0].key).toBe(physicalBayKey(ordinary));
  });

  it("Christmas aisles 40–42 elevate while ordinary aisle remains selectable later", () => {
    const xmas = [40, 41, 42].map((aisle) =>
      loc({
        id: `x${aisle}`,
        aisle: String(aisle),
        bay: 1,
        status: "PENDING",
        last_completed_at: "2026-09-01T00:00:00Z",
      })
    );
    const ordinary = Array.from({ length: 6 }, (_, i) =>
      loc({
        id: `n${i}`,
        aisle: "20",
        bay: i + 1,
        status: "PENDING",
        last_completed_at: "2026-01-01T00:00:00Z",
      })
    );
    const seasonalKeys = xmas.map((l) => physicalBayKey(l));
    const first3 = selectPhysicalBayCoverage([...ordinary, ...xmas], [], 3, {
      seasonalHighPhysicalKeys: seasonalKeys,
    });
    expect(first3).toHaveLength(3);
    expect(first3.every((s) => seasonalKeys.includes(s.key))).toBe(true);

    // After "completing" seasonal bays (remove from owed), ordinary still drawn.
    const after = selectPhysicalBayCoverage(ordinary, [], 3, {
      seasonalHighPhysicalKeys: seasonalKeys,
    });
    expect(after).toHaveLength(3);
    expect(after.every((s) => s.key.startsWith("dept-1|20|"))).toBe(true);
  });
});

describe("ENGINE-PROD-004 ENGINE-PROD-002/003 compatibility", () => {
  it("seasonal pressure does not change people×3 volume", () => {
    const pool = Array.from({ length: 30 }, (_, i) =>
      loc({
        id: `p${i}`,
        aisle: String(10 + Math.floor(i / 10)),
        bay: (i % 10) + 1,
      })
    );
    const seasonalKeys = pool
      .filter((_, i) => i < 10)
      .map((l) => physicalBayKey(l));
    const target = resolveAutomaticWeeklyBayTarget(4);
    expect(target).toBe(12);
    const selected = selectPhysicalBayCoverage(pool, [], target, {
      seasonalHighPhysicalKeys: seasonalKeys,
    });
    expect(selected).toHaveLength(12);
  });

  it("extra-bay selector honors seasonal HIGH", () => {
    const ordinary = loc({ id: "o1", aisle: "10", bay: 1 });
    const seasonalBay = loc({ id: "x1", aisle: "40", bay: 1 });
    const next = selectNextExtraPhysicalBay(
      [ordinary, seasonalBay],
      [],
      [],
      { seasonalHighPhysicalKeys: [physicalBayKey(seasonalBay)] }
    );
    expect(next?.key).toBe(physicalBayKey(seasonalBay));
  });
});

describe("ENGINE-PROD-004 aisle priority + UI wiring", () => {
  it("aisle priority module discloses clear erases individual locks", () => {
    const src = readRepo("lib/store-ops/aisle-priority.ts");
    expect(src).toMatch(/clear_erases_individual_locks/);
    expect(src).toMatch(/Approach A/);
    expect(src).toMatch(/priority_override/);
  });

  it("UI surfaces exist for aisle priority and seasonal aisle assign", () => {
    expect(readRepo("components/admin/AisleBayManager.tsx")).toMatch(
      /Mark aisle high priority/
    );
    expect(readRepo("components/admin/OperationalContextCard.tsx")).toMatch(
      /Assign aisle/
    );
    expect(
      readRepo("app/api/store-locations/aisle-priority/route.ts")
    ).toMatch(/setAislePriorityOverride/);
    expect(
      readRepo(
        "app/api/admin/operational-contexts/[id]/aisle-relevance/route.ts"
      )
    ).toMatch(/setAisleSeasonalLocationRelevance/);
  });
});

describe("ENGINE-PROD-004 starvation / Model A proof", () => {
  it("elevated bays leave the owed pool after completion so ordinary bays are reached", () => {
    // Simulate weeks: each draw picks seasonal first while they remain PENDING;
    // once removed (verified complete), ordinary bays fill subsequent draws.
    let owed = [
      ...[40, 41, 42].map((a) =>
        loc({ id: `x${a}`, aisle: String(a), bay: 1 })
      ),
      ...Array.from({ length: 9 }, (_, i) =>
        loc({ id: `n${i}`, aisle: "20", bay: i + 1 })
      ),
    ];
    const seasonalKeys = owed
      .filter((l) => ["40", "41", "42"].includes(String(l.aisle)))
      .map((l) => physicalBayKey(l));

    const seenOrdinary = new Set<string>();
    while (owed.length >= 3) {
      const pick = selectPhysicalBayCoverage(owed, [], 3, {
        seasonalHighPhysicalKeys: seasonalKeys,
      });
      expect(pick).toHaveLength(3);
      const pickedKeys = new Set(pick.map((p) => p.key));
      for (const p of pick) {
        if (!seasonalKeys.includes(p.key)) seenOrdinary.add(p.key);
      }
      owed = owed.filter((l) => !pickedKeys.has(physicalBayKey(l)));
    }
    expect(seenOrdinary.size).toBeGreaterThan(0);
    expect(owed.every((l) => !seasonalKeys.includes(physicalBayKey(l)))).toBe(
      true
    );
  });
});
