/**
 * UX-REDUCE-002 — This Week ownership composition unit tests.
 */

import { describe, expect, it } from "vitest";
import {
  composeThisWeekOwnership,
  composeThisWeekProgressLine,
  BASE_WEEKLY_BAY_QUOTA,
} from "./this-week-ownership";
import type { SundayAssignmentMap } from "./sunday-audit";
import type { WeeklyRotationWithLocation } from "./types";
import type { StoreSpecialist } from "@/lib/types";

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
  location: ReturnType<typeof loc>,
  extras: Partial<WeeklyRotationWithLocation> = {}
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
    ...extras,
  } as WeeklyRotationWithLocation;
}

function member(id: string, name: string): StoreSpecialist {
  return {
    id,
    name,
    role: "Associate",
    username: name.toLowerCase(),
    pin: "1234",
    pin_code: "1234",
    store_number: "1124",
    is_active: true,
    assigned_department: "flooring",
    must_change_credentials: false,
    created_at: "2026-01-01T00:00:00Z",
  } as unknown as StoreSpecialist;
}

describe("composeThisWeekOwnership", () => {
  it("groups four owners with three physical bays each (healthy week)", () => {
    const owners = ["tyson", "nick", "tracy", "nate"];
    const rotations: WeeklyRotationWithLocation[] = [];
    const assignments: SundayAssignmentMap = {};
    let bay = 1;
    for (const ownerId of owners) {
      for (let i = 0; i < BASE_WEEKLY_BAY_QUOTA; i += 1) {
        const rotId = `${ownerId}-${i}`;
        const location = loc(`loc-${rotId}`, "dept-1", "41", bay);
        bay += 1;
        rotations.push(rotation(rotId, location));
        assignments[rotId] = {
          specialist_id: ownerId,
          specialist_name: ownerId,
          assigned_at: "2026-09-14T12:00:00Z",
        };
      }
    }
    const roster = owners.map((id) => member(id, id[0]!.toUpperCase() + id.slice(1)));
    const plan = composeThisWeekOwnership({ rotations, assignments, roster });

    expect(plan.hasPlan).toBe(true);
    expect(plan.isHealthyOwnedPlan).toBe(true);
    expect(plan.needsOwnershipRecovery).toBe(false);
    expect(plan.physicalBayCount).toBe(12);
    expect(plan.owners).toHaveLength(4);
    for (const owner of plan.owners) {
      expect(owner.bays).toHaveLength(3);
      expect(owner.canAddAnotherBay).toBe(true);
    }
    expect(composeThisWeekProgressLine(plan)).toContain("12 assigned");
  });

  it("collapses SELLING/TOPSTOCK siblings to one physical bay", () => {
    const selling = loc("s1", "dept-1", "10", 5, "SELLING");
    const top = loc("t1", "dept-1", "10", 5, "TOPSTOCK");
    const rotations = [
      rotation("r-sell", selling),
      rotation("r-top", top),
    ];
    const assignments: SundayAssignmentMap = {
      "r-sell": {
        specialist_id: "tyson",
        specialist_name: "Tyson",
        assigned_at: "2026-09-14T12:00:00Z",
      },
      "r-top": {
        specialist_id: "tyson",
        specialist_name: "Tyson",
        assigned_at: "2026-09-14T12:00:00Z",
      },
    };
    const plan = composeThisWeekOwnership({
      rotations,
      assignments,
      roster: [member("tyson", "Tyson")],
    });
    expect(plan.physicalBayCount).toBe(1);
    expect(plan.owners).toHaveLength(1);
    expect(plan.owners[0]!.bays).toHaveLength(1);
    expect(plan.owners[0]!.bays[0]!.label).toBe("A10-B05");
  });

  it("surfaces awaiting verification without inventing owners", () => {
    const location = loc("loc-1", "dept-1", "42", 1);
    const rotations = [
      rotation("r1", location, {
        is_completed: true,
        verification_status: "PENDING_VERIFICATION",
      }),
    ];
    const assignments: SundayAssignmentMap = {
      r1: {
        specialist_id: "nick",
        specialist_name: "Nick",
        assigned_at: "2026-09-14T12:00:00Z",
      },
    };
    const plan = composeThisWeekOwnership({ rotations, assignments });
    expect(plan.pendingVerificationCount).toBe(1);
    expect(plan.owners[0]!.awaitingVerificationCount).toBe(1);
    expect(plan.isHealthyOwnedPlan).toBe(true);
  });

  it("marks barrier bays as unresolved coverage", () => {
    const location = loc("loc-1", "dept-1", "42", 2);
    const rotations = [rotation("r1", location)];
    const assignments: SundayAssignmentMap = {
      r1: {
        specialist_id: "tracy",
        specialist_name: "Tracy",
        assigned_at: "2026-09-14T12:00:00Z",
      },
    };
    const plan = composeThisWeekOwnership({
      rotations,
      assignments,
      barrierRotationIds: ["r1"],
    });
    expect(plan.barrierBayCount).toBe(1);
    expect(plan.owners[0]!.bays[0]!.lifecycle).toBe("barrier");
    expect(plan.verifiedCount).toBe(0);
  });

  it("flags staged but unowned as ownership recovery", () => {
    const rotations = [
      rotation("r1", loc("a", "dept-1", "1", 1)),
      rotation("r2", loc("b", "dept-1", "1", 2)),
    ];
    const assignments: SundayAssignmentMap = {
      r1: {
        specialist_id: "nate",
        specialist_name: "Nate",
        assigned_at: "2026-09-14T12:00:00Z",
      },
    };
    const plan = composeThisWeekOwnership({ rotations, assignments });
    expect(plan.needsOwnershipRecovery).toBe(true);
    expect(plan.isHealthyOwnedPlan).toBe(false);
    expect(plan.unownedPhysicalBayCount).toBe(1);
    expect(plan.owners[0]!.canAddAnotherBay).toBe(false);
  });

  it("no plan does not fabricate assignments", () => {
    const plan = composeThisWeekOwnership({
      rotations: [],
      assignments: {},
    });
    expect(plan.hasPlan).toBe(false);
    expect(plan.needsDispatchRecovery).toBe(true);
    expect(plan.owners).toHaveLength(0);
    expect(composeThisWeekProgressLine(plan)).toMatch(/No bays assigned/i);
  });

  it("+1 eligibility requires complete base ownership and quota", () => {
    const rotations = [
      rotation("r1", loc("a", "dept-1", "1", 1)),
      rotation("r2", loc("b", "dept-1", "1", 2)),
      rotation("r3", loc("c", "dept-1", "1", 3)),
      rotation("r4", loc("d", "dept-1", "1", 4)),
    ];
    const assignments: SundayAssignmentMap = {
      r1: {
        specialist_id: "tyson",
        specialist_name: "Tyson",
        assigned_at: "x",
      },
      r2: {
        specialist_id: "tyson",
        specialist_name: "Tyson",
        assigned_at: "x",
      },
      r3: {
        specialist_id: "tyson",
        specialist_name: "Tyson",
        assigned_at: "x",
      },
      r4: {
        specialist_id: "nick",
        specialist_name: "Nick",
        assigned_at: "x",
      },
    };
    const plan = composeThisWeekOwnership({ rotations, assignments });
    const tyson = plan.owners.find((o) => o.specialistId === "tyson");
    const nick = plan.owners.find((o) => o.specialistId === "nick");
    expect(tyson?.bays).toHaveLength(3);
    expect(tyson?.canAddAnotherBay).toBe(true);
    expect(nick?.bays).toHaveLength(1);
    expect(nick?.canAddAnotherBay).toBe(false);
  });
});
