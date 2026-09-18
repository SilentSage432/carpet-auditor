/**
 * PERF-LOAD-002 — Floor/Roster P0 render unlock contracts.
 *
 * Load the minimum operational truth first.
 * Supporting detail may arrive progressively.
 * Faster presentation may not weaken truth.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatOwnedBayCaption } from "./roster-people-presentation";
import { composeThisWeekOwnership } from "./this-week-ownership";
import type { SundayAssignmentMap } from "./sunday-audit";
import type { WeeklyRotationWithLocation } from "./types";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function loc(
  id: string,
  dept: string,
  aisle: string,
  bay: number,
  type: "SELLING" | "TOPSTOCK" = "SELLING"
) {
  return {
    id,
    store_id: "s1",
    department_id: dept,
    aisle,
    bay,
    type,
    status: "PENDING",
    is_active: true,
    location_type: "STANDARD" as const,
  };
}

function rotation(
  id: string,
  location: ReturnType<typeof loc>
): WeeklyRotationWithLocation {
  return {
    id,
    store_id: "s1",
    department_id: location.department_id,
    location_id: location.id,
    assigned_week: "2026-W38",
    is_completed: false,
    verification_status: "PENDING",
    store_locations: location as WeeklyRotationWithLocation["store_locations"],
  } as WeeklyRotationWithLocation;
}

describe("PERF-LOAD-002 Floor P0 unlock", () => {
  const floor = readRepo("components/hub/tabs/FloorTab.tsx");

  it("does not block P0 ownership on store_locations Promise.all", () => {
    expect(floor).not.toMatch(
      /Promise\.all\(\[\s*fetchThisWeekRotations[\s\S]*?fetchStoreLocationsDetailed/
    );
    expect(floor).toContain("fetchThisWeekRotations(member, nextDeptId)");
    expect(floor).toContain("fetchStoreLocationsDetailed(member, nextDeptId)");
    expect(floor).toMatch(/store locations failed \(non-blocking\)/);
  });

  it("awaits authoritative sunday_bay_assignments before clearing loading", () => {
    expect(floor).toMatch(
      /if \(nextWeek\) \{\s*await loadAssignments\(nextWeek\);/
    );
    expect(floor).toContain("await loadAssignments");
  });

  it("does not fabricate owners before assignments resolve", () => {
    const rotations = [
      rotation("r1", loc("l1", "dept-1", "41", 11)),
      rotation("r2", loc("l2", "dept-1", "41", 12)),
    ];
    const pending = composeThisWeekOwnership({
      rotations,
      assignments: {},
    });
    expect(pending.owners).toHaveLength(0);
    expect(pending.unownedPhysicalBayCount).toBe(2);
    expect(pending.isHealthyOwnedPlan).toBe(false);

    const owned: SundayAssignmentMap = {
      r1: {
        specialist_id: "p1",
        specialist_name: "Pat",
        assigned_at: "2026-09-14T12:00:00Z",
      },
      r2: {
        specialist_id: "p1",
        specialist_name: "Pat",
        assigned_at: "2026-09-14T12:00:00Z",
      },
    };
    const ready = composeThisWeekOwnership({ rotations, assignments: owned });
    expect(ready.owners).toHaveLength(1);
    expect(ready.owners[0]?.specialistName).toBe("Pat");
    expect(ready.unownedPhysicalBayCount).toBe(0);
  });

  it("keeps physical-bay dedupe across SELLING/TOPSTOCK siblings", () => {
    const plan = composeThisWeekOwnership({
      rotations: [
        rotation("r-sell", loc("s1", "dept-1", "10", 5, "SELLING")),
        rotation("r-top", loc("t1", "dept-1", "10", 5, "TOPSTOCK")),
      ],
      assignments: {},
    });
    expect(plan.physicalBayCount).toBe(1);
    expect(plan.isHealthyOwnedPlan).toBe(false);
  });

  it("attention strip stays hidden while LOADING (no false healthy)", () => {
    const visibility = readRepo("lib/store-ops/floor-attention-visibility.ts");
    expect(visibility).toContain(
      'if (status === "IDLE" || status === "LOADING") return false'
    );
  });

  it("parallelizes durable rotation/location peeks", () => {
    expect(floor).toMatch(
      /Promise\.all\(\[\s*peekCachedRotations[\s\S]*?peekCachedStoreLocations/
    );
  });
});

describe("PERF-LOAD-002 Roster P0 unlock", () => {
  const roster = readRepo("components/hub/tabs/RosterTab.tsx");

  it("clears loading after people+schedule P0, before sunday assignments", () => {
    expect(roster).toMatch(
      /\/\/ P0: people \+ schedule\/TIME-DUTY truth[\s\S]*?setLoading\(false\);[\s\S]*?\/\/ P1: weekly ownership[\s\S]*?fetchSundayAssignments/
    );
  });

  it("never shows false 0 bays from formatOwnedBayCaption", () => {
    expect(formatOwnedBayCaption(0)).toBeNull();
    expect(formatOwnedBayCaption(2)).toBe("2 bays still owned this week");
  });

  it("gates owned-bay caption and Reassign on assignmentsKnown", () => {
    expect(roster).toMatch(
      /calledOut &&\s*canShift &&\s*assignmentsKnown &&\s*ownedBays > 0/
    );
    expect(roster).toMatch(
      /calledOut && assignmentsKnown\s*\?\s*formatOwnedBayCaption\(ownedBays\)/
    );
    expect(roster).not.toMatch(
      /showReassign =\s*calledOut &&\s*canShift &&\s*\(!assignmentsKnown \|\|/
    );
  });

  it("manage-sheet Reassign also requires known ownership", () => {
    expect(roster).toMatch(
      /assignmentsKnown &&\s*countWeeklyOwnership\(\s*weekAssignments,\s*String\(manageTarget\.id\)\s*\) > 0/
    );
  });
});

describe("PERF-LOAD-002 performance law documentation anchors", () => {
  it("Floor reload documents P0 vs supporting locations", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).toMatch(/P0 gate/);
    expect(floor).toMatch(/must not block ownership paint/);
  });
});
