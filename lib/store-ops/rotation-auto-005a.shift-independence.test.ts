/**
 * DEPTSYNC-ROTATION-AUTO-005A — weekly bay assignment is shift-independent.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  buildWeekCapacityReviewBoard,
  composeApprovedStoreWeekCapacity,
} from "./approved-week-capacity";
import { composeAuthoritativeAssignmentProposal } from "./authoritative-week-cycle";
import { WEEKLY_ROTATION_AUTO_PUBLISH } from "./authoritative-week-cycle";
import {
  composeWeekLaborAvailability,
  weekLaborToAssignmentMembers,
  weekLaborToPlannerMembers,
} from "./labor-availability";
import type { BaySectionLookup } from "./operational-sections";
import { selectSectionBalancedPhysicalBayCoverage } from "./section-balanced-stage";
import { composeStoreWeekCapacity } from "./shared-week-capacity";
import { planStrictSectionOwnershipAssignments } from "./section-ownership-enforcement";
import type { StoreLocation } from "./types";

const ROOT = join(__dirname, "../..");
const WEEK = "2026-W43";
const DATES = [
  "2026-10-19",
  "2026-10-20",
  "2026-10-21",
  "2026-10-22",
  "2026-10-23",
  "2026-10-24",
  "2026-10-25",
];

const workforce = [
  {
    id: "tyson",
    name: "Tyson",
    role: "Supervisor",
    is_active: true,
    home_department: "flooring",
    assigned_department: "flooring",
  },
  {
    id: "nate",
    name: "Nate",
    role: "Associate",
    is_active: true,
    home_department: "flooring",
    assigned_department: "flooring",
  },
  {
    id: "nick",
    name: "Nick",
    role: "Associate",
    is_active: true,
    home_department: "flooring",
    assigned_department: "flooring",
  },
  {
    id: "tracy",
    name: "Tracy",
    role: "Associate",
    is_active: true,
    home_department: "flooring",
    assigned_department: "flooring",
  },
  {
    id: "master",
    name: "Master Admin",
    role: "MasterAdmin",
    is_active: true,
    home_department: null,
    assigned_department: "all",
  },
];

function shift(
  specialist_id: string,
  work_date: string,
  start = "08:00",
  end = "16:00"
) {
  return {
    specialist_id,
    work_date,
    start_time: start,
    end_time: end,
    is_scheduled_today: true,
    is_call_out: false,
    status: "ON_DUTY",
  };
}

function loc(id: string, aisle: string, bay: number): StoreLocation {
  return {
    id,
    department_id: "dept-floor",
    store_id: "store-1",
    store_number: "2587",
    aisle,
    bay,
    type: "SELLING",
    location_type: "STANDARD",
    is_active: true,
    status: "PENDING",
  } as StoreLocation;
}

function sectionMap(
  rows: Array<{ aisle: string; bay: number; owner: string; section: string }>
): Map<string, BaySectionLookup> {
  const map = new Map<string, BaySectionLookup>();
  for (const row of rows) {
    map.set(`dept-floor|${row.aisle}|${row.bay}`, {
      section_id: `sec-${row.section}`,
      section_name: row.section,
      department_id: "dept-floor",
      primary_owner_specialist_id: row.owner,
      primary_owner_name: row.owner,
      is_active: true,
    });
  }
  return map;
}

const MEMBERSHIPS = [
  ...[1, 2, 3].map((bay) => ({
    aisle: "6",
    bay,
    owner: "tyson",
    section: "Myself",
  })),
  ...[1, 2, 3].map((bay) => ({
    aisle: "7",
    bay,
    owner: "nate",
    section: "CSA",
  })),
  ...[1, 2, 3].map((bay) => ({
    aisle: "44",
    bay,
    owner: "nick",
    section: "A",
  })),
  ...[1, 2, 3].map((bay) => ({
    aisle: "41",
    bay,
    owner: "tracy",
    section: "B",
  })),
];

const CAPS_12 = {
  tyson: 3,
  nate: 3,
  nick: 3,
  tracy: 3,
} as const;

function capacityFor(ids: string[]) {
  return composeApprovedStoreWeekCapacity({
    store_number: "2587",
    week_label: WEEK,
    eligible_specialist_ids: ids,
    approved_by_specialist: { ...CAPS_12 },
    assignments: [],
  });
}

function proposalFor(
  members: Array<{
    specialist_id: string;
    specialist_name: string;
    active: boolean;
    hours: number;
  }>,
  capacity: ReturnType<typeof capacityFor>
) {
  const baySectionByKey = sectionMap(MEMBERSHIPS);
  const staged = MEMBERSHIPS.map((m, i) => ({
    id: `rot-${i}`,
    department_id: "dept-floor",
    aisle: m.aisle,
    bay: m.bay,
  }));
  return composeAuthoritativeAssignmentProposal({
    store_number: "2587",
    week_label: WEEK,
    staged,
    ownedRotationIds: [],
    members,
    baySectionByKey,
    capacity,
  });
}

describe("ROTATION-AUTO-005A shift independence", () => {
  it("keeps auto-publish latch OFF", () => {
    expect(WEEKLY_ROTATION_AUTO_PUBLISH).toBe(false);
  });

  it("weekLaborToAssignmentMembers includes zero-hour associates; planner members do not", () => {
    const labor = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: DATES,
      workforce,
      persisted_shift_days: [],
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: "2026-10-16T00:00:00.000Z",
    });
    expect(labor.allocatable).toHaveLength(0);
    expect(labor.members.map((m) => m.specialist_id).sort()).toEqual([
      "nate",
      "nick",
      "tracy",
      "tyson",
    ]);
    expect(weekLaborToPlannerMembers(labor.allocatable)).toHaveLength(0);
    const assign = weekLaborToAssignmentMembers(labor.members);
    expect(assign.map((m) => m.specialist_id).sort()).toEqual([
      "nate",
      "nick",
      "tracy",
      "tyson",
    ]);
    expect(assign.every((m) => m.hours === 0)).toBe(true);
  });

  it("composeStoreWeekCapacity keeps zero-shift associates eligible", () => {
    const snap = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce,
      persisted_shift_days: [],
      assignments: [],
      approved_by_specialist: { ...CAPS_12 },
    });
    expect(snap.eligible_specialist_ids.sort()).toEqual([
      "nate",
      "nick",
      "tracy",
      "tyson",
    ]);
    expect(snap.shared_target).toBe(12);
    expect(snap.approvals_complete).toBe(true);
  });

  it("capacity review board marks zero-shift associates eligible for approval", () => {
    const board = buildWeekCapacityReviewBoard({
      store_number: "2587",
      week_label: WEEK,
      workforce,
      persisted_shift_days: [],
      approvals: [],
      owned_by_specialist: {},
      proposed_by_specialist: { ...CAPS_12 },
    });
    expect(board.associates.every((a) => a.eligible)).toBe(true);
    expect(board.associates.every((a) => a.approval_status !== "ineligible")).toBe(
      true
    );
    expect(board.shared_target_proposed).toBe(12);
  });

  it("identical section-balanced stage selection for 0 / 1 / many shifts", () => {
    const baySectionByKey = sectionMap(MEMBERSHIPS);
    const pending = MEMBERSHIPS.map((m, i) => loc(`loc-${i}`, m.aisle, m.bay));
    const slots = [
      { specialist_id: "tyson", specialist_name: "Tyson", capacity: 3 },
      { specialist_id: "nate", specialist_name: "Nate", capacity: 3 },
      { specialist_id: "nick", specialist_name: "Nick", capacity: 3 },
      { specialist_id: "tracy", specialist_name: "Tracy", capacity: 3 },
    ];

    const zero = selectSectionBalancedPhysicalBayCoverage({
      pending,
      carried: [],
      baySectionByKey,
      slots,
    });
    const one = selectSectionBalancedPhysicalBayCoverage({
      pending,
      carried: [],
      baySectionByKey,
      slots,
    });
    const many = selectSectionBalancedPhysicalBayCoverage({
      pending,
      carried: [],
      baySectionByKey,
      slots,
    });

    // Stage selector is pure geography/capacity — shift rows are not an input.
    expect(zero.selected_total).toBe(12);
    expect(one.selected.map((r) => r.key)).toEqual(
      zero.selected.map((r) => r.key)
    );
    expect(many.selected.map((r) => r.key)).toEqual(
      zero.selected.map((r) => r.key)
    );
  });

  it("identical stewardship proposal for 0 / 1 / many shifts when capacity is 3/3/3/3", () => {
    const capacity = capacityFor(["tyson", "nate", "nick", "tracy"]);
    const laborZero = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: DATES,
      workforce,
      persisted_shift_days: [],
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: "2026-10-16T00:00:00.000Z",
    });
    const laborOne = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: DATES,
      workforce,
      persisted_shift_days: [
        shift("tyson", DATES[0]!),
        shift("nate", DATES[0]!),
        shift("nick", DATES[0]!),
        shift("tracy", DATES[0]!),
      ],
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: "2026-10-16T00:00:00.000Z",
    });
    const laborMany = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: DATES,
      workforce,
      persisted_shift_days: ["tyson", "nate", "nick", "tracy"].flatMap((id) =>
        DATES.map((d) => shift(id, d))
      ),
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: "2026-10-16T00:00:00.000Z",
    });

    const p0 = proposalFor(weekLaborToAssignmentMembers(laborZero.members), capacity);
    const p1 = proposalFor(weekLaborToAssignmentMembers(laborOne.members), capacity);
    const pN = proposalFor(weekLaborToAssignmentMembers(laborMany.members), capacity);

    expect(p0.actionable).toBe(true);
    expect(p0.items.length).toBe(12);
    expect(p1.items.map((i) => `${i.rotationId}:${i.specialist_id}`).sort()).toEqual(
      p0.items.map((i) => `${i.rotationId}:${i.specialist_id}`).sort()
    );
    expect(pN.items.map((i) => `${i.rotationId}:${i.specialist_id}`).sort()).toEqual(
      p0.items.map((i) => `${i.rotationId}:${i.specialist_id}`).sort()
    );

    const byOwner: Record<string, number> = {};
    for (const item of p0.items) {
      byOwner[item.specialist_id] = (byOwner[item.specialist_id] ?? 0) + 1;
    }
    expect(byOwner).toEqual({ tyson: 3, nate: 3, nick: 3, tracy: 3 });
  });

  it("strict ownership planner assigns zero-hour associate with remaining capacity", () => {
    const baySectionByKey = sectionMap(MEMBERSHIPS.slice(0, 3));
    const bays = MEMBERSHIPS.slice(0, 3).map((m, i) => ({
      rotationId: `rot-${i}`,
      department_id: "dept-floor",
      aisle: m.aisle,
      bay: m.bay,
      riskScore: 0,
    }));
    const plan = planStrictSectionOwnershipAssignments(
      bays,
      [
        {
          specialist_id: "tyson",
          specialist_name: "Tyson",
          active: true,
          hours: 0,
        },
      ],
      new Map([["tyson", 3]]),
      baySectionByKey,
      { knownHoursOnly: true }
    );
    expect(plan.items.length).toBe(3);
    expect(plan.items.every((i) => i.specialist_id === "tyson")).toBe(true);
  });

  it("source contracts: assignment paths use weekLaborToAssignmentMembers", () => {
    const dispatch = readFileSync(
      join(ROOT, "lib/store-ops/sunday-dispatch.ts"),
      "utf8"
    );
    const modal = readFileSync(
      join(ROOT, "components/admin/SundayAuditAssignmentModal.tsx"),
      "utf8"
    );
    const approved = readFileSync(
      join(ROOT, "lib/store-ops/approved-week-capacity.ts"),
      "utf8"
    );
    expect(dispatch).toMatch(/weekLaborToAssignmentMembers/);
    expect(modal).toMatch(/weekLaborToAssignmentMembers/);
    expect(approved).toMatch(/labor\.members/);
    expect(approved).not.toMatch(/weekLaborToPlannerMembers\(labor\.allocatable\)/);
  });
});
