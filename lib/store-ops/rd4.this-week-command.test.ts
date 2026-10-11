/**
 * DEPTSYNC-RD-4 — This Week command board unit coverage.
 */

import { describe, expect, it } from "vitest";
import {
  assignmentResponsibilityLabel,
  completionEvidenceLabel,
  composeThisWeekCommandSummary,
  composeThisWeekOwnership,
  SHARED_TEAM_WEEKLY_CAPACITY,
  BASE_WEEKLY_BAY_QUOTA,
} from "./this-week-ownership";
import {
  buildMapBayFocusHref,
  resolveMapBayFocusIntent,
} from "./map-bay-focus";
import type { SundayAssignmentMap } from "./sunday-audit";
import type { WeeklyRotationWithLocation } from "./types";
import type { StoreSpecialist } from "@/lib/types";
import type { BaySectionLookup } from "./operational-sections";

function loc(id: string, dept: string, aisle: string, bay: number) {
  return {
    id,
    store_id: "s1",
    department_id: dept,
    aisle,
    bay,
    type: "SELLING" as const,
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
    assigned_week: "2026-W41",
    is_completed: false,
    verification_status: "PENDING",
    store_locations: location as WeeklyRotationWithLocation["store_locations"],
    ...extras,
  } as WeeklyRotationWithLocation;
}

function member(id: string, name: string, role = "Associate"): StoreSpecialist {
  return {
    id,
    name,
    role,
    username: name.toLowerCase(),
    pin: "1234",
    pin_code: "1234",
    store_number: "2587",
    is_active: true,
    assigned_department: "flooring",
    must_change_credentials: false,
    created_at: "2026-01-01T00:00:00Z",
  } as unknown as StoreSpecialist;
}

describe("RD-4 weekly command summary", () => {
  it("separates planned, assigned, reported, verified, and remaining", () => {
    const rotations = [
      rotation("r-open", loc("a", "d1", "12", 1)),
      rotation("r-reported", loc("b", "d1", "12", 2), {
        is_completed: true,
        verification_status: "PENDING_VERIFICATION",
      }),
      rotation("r-verified", loc("c", "d1", "12", 3), {
        is_completed: true,
        verification_status: "VERIFIED_COMPLETE",
      }),
      rotation("r-unowned", loc("d", "d1", "12", 4)),
    ];
    const assignments: SundayAssignmentMap = {
      "r-open": {
        specialist_id: "nick",
        specialist_name: "Nick",
        assigned_at: "x",
      },
      "r-reported": {
        specialist_id: "nick",
        specialist_name: "Nick",
        assigned_at: "x",
      },
      "r-verified": {
        specialist_id: "tracy",
        specialist_name: "Tracy",
        assigned_at: "x",
      },
    };
    const plan = composeThisWeekOwnership({ rotations, assignments });
    const summary = composeThisWeekCommandSummary(plan, "2026-W41");

    expect(summary.plannedBayCount).toBe(4);
    expect(summary.assignedBayCount).toBe(3);
    expect(summary.unassignedBayCount).toBe(1);
    expect(summary.reportedCompleteCount).toBe(1); // awaiting verify only
    expect(summary.verifiedCount).toBe(1);
    expect(summary.awaitingVerificationCount).toBe(1);
    expect(summary.remainingBayCount).toBe(2); // open + unowned open
    expect(summary.sharedCapacityBays).toBe(SHARED_TEAM_WEEKLY_CAPACITY);
    expect(summary.baysPerPerson).toBe(BASE_WEEKLY_BAY_QUOTA);
    expect(summary.headline).toMatch(/4 planned/);
    expect(summary.headline).toMatch(/3 assigned/);
  });

  it("empty week does not invent plan or capacity evidence", () => {
    const plan = composeThisWeekOwnership({ rotations: [], assignments: {} });
    const summary = composeThisWeekCommandSummary(plan, "2026-W41");
    expect(summary.hasPlan).toBe(false);
    expect(summary.plannedBayCount).toBe(0);
    expect(summary.assignedBayCount).toBe(0);
    expect(summary.verifiedCount).toBe(0);
    expect(summary.sharedCapacityBays).toBe(12);
  });

  it("includes unassigned roster members for coordination without inventing bays", () => {
    const plan = composeThisWeekOwnership({
      rotations: [
        rotation("r1", loc("a", "d1", "1", 1)),
      ],
      assignments: {
        r1: {
          specialist_id: "nick",
          specialist_name: "Nick",
          assigned_at: "x",
        },
      },
      roster: [
        member("nick", "Nick"),
        member("tracy", "Tracy"),
        member("nate", "Nate"),
        member("ds", "Tyson", "Supervisor"),
      ],
      includeUnassignedRoster: true,
    });
    expect(plan.owners.map((o) => o.specialistId).sort()).toEqual([
      "nate",
      "nick",
      "tracy",
    ]);
    const empty = plan.owners.find((o) => o.specialistId === "tracy");
    expect(empty?.bays).toHaveLength(0);
    expect(empty?.isRosterPlaceholder).toBe(true);
  });

  it("attaches Operational Section without confusing steward and assignee", () => {
    const key = "d1|BW|1";
    const section: BaySectionLookup = {
      section_id: "sec-1",
      section_name: "Front Runners",
      department_id: "d1",
      primary_owner_specialist_id: "steward",
      primary_owner_name: "Section Steward",
      is_active: true,
    };
    const plan = composeThisWeekOwnership({
      rotations: [rotation("r1", loc("a", "d1", "BW", 1))],
      assignments: {
        r1: {
          specialist_id: "nick",
          specialist_name: "Nick",
          assigned_at: "x",
        },
      },
      baySectionByKey: new Map([[key, section]]),
    });
    const bay = plan.owners[0]!.bays[0]!;
    expect(bay.section?.section_name).toBe("Front Runners");
    expect(bay.section?.primary_owner_name).toBe("Section Steward");
    expect(assignmentResponsibilityLabel(bay)).toBe("Assigned this week");
    expect(completionEvidenceLabel(bay.lifecycle)).toBe(
      "No completion evidence"
    );
  });

  it("completion evidence labels stay distinct from assignment", () => {
    expect(completionEvidenceLabel("verified")).toBe("Verified complete");
    expect(completionEvidenceLabel("awaiting_verification")).toMatch(
      /awaiting verification/i
    );
    expect(completionEvidenceLabel("open")).toBe("No completion evidence");
  });
});

describe("RD-4 Map bay focus navigation", () => {
  it("builds and resolves aisle/bay focus href", () => {
    const href = buildMapBayFocusHref({
      aisle: " bw ",
      bay: 3,
      departmentId: "dept-1",
    });
    expect(href).toContain("/admin/store-map?");
    expect(href).toContain("aisle=BW");
    expect(href).toContain("bay=3");
    expect(href).toContain("deptId=dept-1");

    const params = new URLSearchParams(href.split("?")[1]);
    const intent = resolveMapBayFocusIntent(params);
    expect(intent).toEqual({
      aisle: "BW",
      bay: 3,
      departmentId: "dept-1",
    });
  });
});
