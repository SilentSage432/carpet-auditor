/**
 * DEPTSYNC-SECTION-ROTATION-005 — operator-approved weekly capacity.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  assertApprovalsReadyForAssignment,
  buildAssociateWeekScheduleFingerprint,
  buildWeekCapacityReviewBoard,
  composeApprovedStoreWeekCapacity,
  isApprovedCapacityValue,
  parseApprovedCapacity,
  SECTION_AWARE_ROTATION_AUTO_STAGE_STILL_OFF,
  validateCapacityApprovalItem,
} from "./approved-week-capacity";
import { filterPlanItemsToCapacity } from "./shared-week-capacity";
import { SECTION_AWARE_ROTATION_AUTO_STAGE } from "./section-aware-rotation";

const ROOT = join(__dirname, "../..");

function readRepo(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const W42 = "2026-W42";

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
    id: "nate",
    name: "Nate",
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

function onDuty(
  specialist_id: string,
  work_date: string,
  start: string,
  end: string
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

/** W42 acceptance schedule evidence (simplified clocks matching day counts). */
const w42Shifts = [
  // Tyson 6 days
  onDuty("tyson", "2026-10-12", "14:00", "23:00"),
  onDuty("tyson", "2026-10-13", "15:00", "23:00"),
  onDuty("tyson", "2026-10-14", "14:00", "23:00"),
  onDuty("tyson", "2026-10-15", "14:00", "23:00"),
  onDuty("tyson", "2026-10-16", "12:00", "21:00"),
  onDuty("tyson", "2026-10-17", "14:00", "23:00"),
  // Nick 5 days
  onDuty("nick", "2026-10-12", "09:00", "18:00"),
  onDuty("nick", "2026-10-13", "09:00", "18:00"),
  onDuty("nick", "2026-10-14", "10:00", "19:00"),
  onDuty("nick", "2026-10-16", "08:00", "17:00"),
  onDuty("nick", "2026-10-17", "08:00", "17:00"),
  // Tracy 4 days
  onDuty("tracy", "2026-10-13", "08:00", "19:00"),
  onDuty("tracy", "2026-10-15", "08:00", "19:00"),
  onDuty("tracy", "2026-10-17", "10:00", "20:00"),
  onDuty("tracy", "2026-10-18", "09:00", "20:00"),
  // Nate 2 days
  onDuty("nate", "2026-10-12", "05:30", "16:30"),
  onDuty("nate", "2026-10-14", "05:30", "16:30"),
];

describe("SECTION-ROTATION-005 capacity values", () => {
  it("A. accepts 0–3", () => {
    for (const n of [0, 1, 2, 3]) {
      expect(isApprovedCapacityValue(n)).toBe(true);
      expect(parseApprovedCapacity(n)).toBe(n);
    }
  });

  it("B. rejects values outside 0–3", () => {
    for (const n of [-1, 4, 1.5, "2", null, undefined]) {
      expect(isApprovedCapacityValue(n)).toBe(false);
    }
  });
});

describe("SECTION-ROTATION-005 approval gates", () => {
  it("C. missing approval blocks assignment", () => {
    const check = assertApprovalsReadyForAssignment({
      approvals_complete: false,
      approved_by_specialist: {},
      eligible_count: 4,
      shared_target: 0,
    });
    expect(check.ok).toBe(false);
  });

  it("D. stale approval is not treated as approved on the board", () => {
    const liveFp = buildAssociateWeekScheduleFingerprint(
      w42Shifts.filter((s) => s.specialist_id === "nate"),
      "nate"
    );
    const board = buildWeekCapacityReviewBoard({
      store_number: "2587",
      week_label: W42,
      workforce,
      persisted_shift_days: w42Shifts,
      approvals: [
        {
          specialist_id: "nate",
          approved_capacity: 2,
          schedule_fingerprint: "stale-fingerprint",
          approved_at: "2026-10-11T00:00:00Z",
          approved_by_specialist_id: "master",
        },
      ],
      owned_by_specialist: {},
    });
    const nate = board.associates.find((a) => a.specialist_id === "nate");
    expect(nate?.approval_status).toBe("stale");
    expect(nate?.schedule_fingerprint).toBe(liveFp);
    expect(board.approvals_complete).toBe(false);
  });

  it("E. ineligible associate cannot receive positive capacity", () => {
    const check = validateCapacityApprovalItem({
      specialist_id: "idle",
      approved_capacity: 2,
      eligible: false,
      owned_count: 0,
      schedule_fingerprint: "abc",
      live_fingerprint: "abc",
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe("CAPACITY_APPROVAL_INELIGIBLE");
  });
});

describe("SECTION-ROTATION-005 Week 42 acceptance", () => {
  it("F. Nate W42 example produces 11-bay shared target", () => {
    const board = buildWeekCapacityReviewBoard({
      store_number: "2587",
      week_label: W42,
      workforce,
      persisted_shift_days: w42Shifts,
      approvals: [],
      owned_by_specialist: {},
      proposed_by_specialist: {
        tyson: 3,
        nick: 3,
        tracy: 3,
        nate: 2,
      },
    });
    expect(board.associates.filter((a) => a.eligible).map((a) => a.specialist_id).sort()).toEqual(
      ["nate", "nick", "tracy", "tyson"]
    );
    expect(board.shared_target_proposed).toBe(11);

    const approved = composeApprovedStoreWeekCapacity({
      store_number: "2587",
      week_label: W42,
      eligible_specialist_ids: ["tyson", "nick", "tracy", "nate"],
      approved_by_specialist: {
        tyson: 3,
        nick: 3,
        tracy: 3,
        nate: 2,
      },
      assignments: [],
    });
    expect(approved.shared_target).toBe(11);
    expect(approved.approvals_complete).toBe(true);
    expect(approved.remaining_by_specialist.nate).toBe(2);
  });

  it("G/H. individual and shared limits enforced in filter", () => {
    const capacity = composeApprovedStoreWeekCapacity({
      store_number: "2587",
      week_label: W42,
      eligible_specialist_ids: ["tyson", "nick", "tracy", "nate"],
      approved_by_specialist: {
        tyson: 3,
        nick: 3,
        tracy: 3,
        nate: 2,
      },
      assignments: [],
    });
    const items = [
      { specialist_id: "nate", rotationId: "r1" },
      { specialist_id: "nate", rotationId: "r2" },
      { specialist_id: "nate", rotationId: "r3" },
      { specialist_id: "tyson", rotationId: "r4" },
    ];
    const { accepted, rejected } = filterPlanItemsToCapacity(items, capacity);
    expect(accepted.filter((i) => i.specialist_id === "nate")).toHaveLength(2);
    expect(rejected.some((i) => i.rotationId === "r3")).toBe(true);
  });

  it("I. existing assignments count toward remaining", () => {
    const capacity = composeApprovedStoreWeekCapacity({
      store_number: "2587",
      week_label: W42,
      eligible_specialist_ids: ["nate"],
      approved_by_specialist: { nate: 2 },
      assignments: [
        {
          bay_id: "a",
          roster_specialist_id: "nate",
          status: "assigned",
          department: "flooring",
        },
      ],
    });
    expect(capacity.owned_total).toBe(1);
    expect(capacity.remaining_by_specialist.nate).toBe(1);
    expect(capacity.remaining_shared).toBe(1);
  });

  it("J. capacity cannot be reduced below committed assignments", () => {
    const check = validateCapacityApprovalItem({
      specialist_id: "tracy",
      approved_capacity: 1,
      eligible: true,
      owned_count: 2,
      schedule_fingerprint: "fp",
      live_fingerprint: "fp",
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe("CAPACITY_APPROVAL_BELOW_OWNED");
  });

  it("L. cross-department owned rows share one pool", () => {
    const capacity = composeApprovedStoreWeekCapacity({
      store_number: "2587",
      week_label: W42,
      eligible_specialist_ids: ["tyson"],
      approved_by_specialist: { tyson: 3 },
      assignments: [
        {
          bay_id: "f1",
          department: "flooring",
          roster_specialist_id: "tyson",
          status: "assigned",
        },
        {
          bay_id: "h1",
          department: "home_decor",
          roster_specialist_id: "tyson",
          status: "completed",
        },
      ],
    });
    expect(capacity.owned_by_specialist.tyson).toBe(2);
    expect(capacity.remaining_by_specialist.tyson).toBe(1);
  });
});

describe("SECTION-ROTATION-005 contracts", () => {
  it("K. migration uses advisory lock for approvals and assignments", () => {
    const sql = readRepo(
      "supabase/migrations/20261016_section_rotation_005_approved_capacity.sql"
    );
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/store_week_capacity:/);
    expect(sql).toMatch(/CAPACITY_APPROVAL_MISSING/);
    expect(sql).toMatch(/CAPACITY_APPROVAL_STALE/);
    expect(sql).toMatch(/upsert_store_week_capacity_approvals/);
  });

  it("M. store isolation via jwt_matches_store + no authenticated writes", () => {
    const sql = readRepo(
      "supabase/migrations/20261016_section_rotation_005_approved_capacity.sql"
    );
    expect(sql).toMatch(/jwt_matches_store/);
    expect(sql).toMatch(/revoke insert, update, delete/);
    expect(sql).toMatch(/grant select on table public.store_week_capacity_approvals/);
  });

  it("N. does not mutate operational sections", () => {
    const sql = readRepo(
      "supabase/migrations/20261016_section_rotation_005_approved_capacity.sql"
    );
    expect(sql).not.toMatch(/operational_sections/);
    expect(sql).not.toMatch(/operational_section_members/);
    const domain = readRepo("lib/store-ops/approved-week-capacity.ts");
    expect(domain).not.toMatch(/operational_sections/);
  });

  it("O. Sunday section-aware auto-stage stays OFF", () => {
    expect(SECTION_AWARE_ROTATION_AUTO_STAGE).toBe(false);
    expect(SECTION_AWARE_ROTATION_AUTO_STAGE_STILL_OFF).toBe(false);
    const aware = readRepo("lib/store-ops/section-aware-rotation.ts");
    expect(aware).toMatch(/SECTION_AWARE_ROTATION_AUTO_STAGE\s*=\s*false/);
  });

  it("P. assignment writers require approved capacity helper", () => {
    const audit = readRepo("lib/store-ops/sunday-audit.ts");
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(audit).toMatch(/assertApprovedCapacityReady/);
    expect(dispatch).toMatch(/assertApprovedCapacityReady/);
    expect(audit).toMatch(/writeSundayAssignmentsWithCapacity/);
    expect(dispatch).toMatch(/writeSundayAssignmentsWithCapacity/);
  });

  it("API requires MasterAdmin for approval writes", () => {
    const route = readRepo("app/api/week-capacity/route.ts");
    expect(route).toMatch(/requireSuperAdmin/);
    expect(route).toMatch(/upsert_store_week_capacity_approvals|writeWeekCapacityApprovals/);
  });

  it("suggested default is not treated as approval", () => {
    const board = buildWeekCapacityReviewBoard({
      store_number: "2587",
      week_label: W42,
      workforce,
      persisted_shift_days: w42Shifts,
      approvals: [],
      owned_by_specialist: {},
    });
    expect(board.approvals_complete).toBe(false);
    expect(
      board.associates.every(
        (a) => !a.eligible || a.approval_status === "missing"
      )
    ).toBe(true);
    expect(board.associates.find((a) => a.specialist_id === "nate")?.suggested_capacity).toBe(
      3
    );
  });

  it("MasterAdmin is not a rotation capacity participant", () => {
    const board = buildWeekCapacityReviewBoard({
      store_number: "2587",
      week_label: W42,
      workforce,
      persisted_shift_days: w42Shifts,
      approvals: [],
      owned_by_specialist: {},
    });
    expect(board.associates.some((a) => a.specialist_id === "master")).toBe(
      false
    );
  });
});
