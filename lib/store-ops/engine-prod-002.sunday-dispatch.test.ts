/**
 * ENGINE-PROD-002 — zero-touch three-bay Sunday dispatch.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  BASE_WEEKLY_BAY_QUOTA,
  flatQuotas,
  planFlatBayAssignments,
  planProportionalBayAssignments,
  type RotationBayRef,
  type ShiftRosterMember,
} from "./weekly-rotations";
import { resolveAutomaticWeeklyBayTarget } from "./week";
import { evaluateSundayAutoRun } from "./sunday-schedule";
import { physicalBayKey } from "./physical-bay";
import {
  composeWeekLaborAvailability,
  weekLaborToPlannerMembers,
} from "./labor-availability";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function bay(id: string, aisle = "12", n = 1): RotationBayRef {
  return { rotationId: id, aisle, bay: n, riskScore: 0 };
}

function member(
  id: string,
  hours: number,
  active = true
): ShiftRosterMember {
  return {
    specialist_id: id,
    specialist_name: id,
    active,
    hours,
  };
}

describe("ENGINE-PROD-002 flat base quota", () => {
  it("exports base weekly quota of exactly 3", () => {
    expect(BASE_WEEKLY_BAY_QUOTA).toBe(3);
  });

  it("4 eligible / 12 bays → exactly 3 each (not proportional)", () => {
    const bays = Array.from({ length: 12 }, (_, i) =>
      bay(`r${i}`, "10", i + 1)
    );
    const plan = planFlatBayAssignments(
      bays,
      [member("a", 40), member("b", 40), member("c", 40), member("d", 40)],
      { knownHoursOnly: true }
    );
    const counts = Object.fromEntries(
      plan.loads.map((l) => [l.specialist_id, l.quota])
    );
    expect(counts).toEqual({ a: 3, b: 3, c: 3, d: 3 });
    expect(plan.items).toHaveLength(12);
  });

  it("unequal hours 40/32/16/20 still → 3/3/3/3", () => {
    const bays = Array.from({ length: 12 }, (_, i) => bay(`r${i}`));
    const plan = planFlatBayAssignments(
      bays,
      [
        member("a", 40),
        member("b", 32),
        member("c", 16),
        member("d", 20),
      ],
      { knownHoursOnly: true }
    );
    const byId = Object.fromEntries(
      plan.loads.map((l) => [l.specialist_id, l.quota])
    );
    expect(byId).toEqual({ a: 3, b: 3, c: 3, d: 3 });
    // Proportional would NOT produce this — prove divergence.
    const proportional = planProportionalBayAssignments(
      bays,
      [
        member("a", 40),
        member("b", 32),
        member("c", 16),
        member("d", 20),
      ],
      { knownHoursOnly: true }
    );
    const prop = Object.fromEntries(
      proportional.loads.map((l) => [l.specialist_id, l.quota])
    );
    expect(prop).not.toEqual({ a: 3, b: 3, c: 3, d: 3 });
  });

  it("zero known hours are not eligible", () => {
    const plan = planFlatBayAssignments(
      [bay("r1"), bay("r2"), bay("r3")],
      [member("zero", 0), member("ok", 8)],
      { knownHoursOnly: true }
    );
    expect(plan.loads.map((l) => l.specialist_id)).toEqual(["ok"]);
    expect(plan.loads[0]?.quota).toBe(3);
    expect(plan.items).toHaveLength(3);
  });

  it("insufficient bays distribute evenly without inventing work", () => {
    expect(flatQuotas(4, 7, 3)).toEqual([2, 2, 2, 1]);
    const plan = planFlatBayAssignments(
      Array.from({ length: 7 }, (_, i) => bay(`r${i}`)),
      [member("a", 40), member("b", 40), member("c", 40), member("d", 40)],
      { knownHoursOnly: true }
    );
    const quotas = plan.loads.map((l) => l.quota).sort((x, y) => y - x);
    expect(quotas).toEqual([2, 2, 2, 1]);
    expect(plan.items).toHaveLength(7);
  });

  it("automatic staging volume is eligible × 3", () => {
    expect(resolveAutomaticWeeklyBayTarget(4)).toBe(12);
    expect(resolveAutomaticWeeklyBayTarget(5)).toBe(15);
    expect(resolveAutomaticWeeklyBayTarget(3)).toBe(9);
    expect(resolveAutomaticWeeklyBayTarget(0)).toBe(0);
  });
});

describe("ENGINE-PROD-002 eligibility (LAB-WEEK-002 preserved)", () => {
  it("Off Sunday but ON_DUTY later in ISO week remains allocatable", () => {
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: "2026-W38",
      dates: [
        "2026-09-14",
        "2026-09-15",
        "2026-09-16",
        "2026-09-17",
        "2026-09-18",
        "2026-09-19",
        "2026-09-20",
      ],
      workforce: [
        {
          id: "a1",
          name: "A",
          role: "Associate",
          is_active: true,
          home_department: "flooring",
        },
      ],
      persisted_shift_days: [
        {
          specialist_id: "a1",
          work_date: "2026-09-14",
          start_time: null,
          end_time: null,
          is_scheduled_today: false,
          is_call_out: false,
          status: "OFF",
        },
        {
          specialist_id: "a1",
          work_date: "2026-09-15",
          start_time: "07:00",
          end_time: "15:30",
          is_scheduled_today: true,
          is_call_out: false,
          status: "ON_DUTY",
        },
      ],
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: "2026-09-14T12:00:00.000Z",
    });
    expect(result.allocatable).toHaveLength(1);
    expect(result.allocatable[0]?.known_available_hours).toBeGreaterThan(0);
    const members = weekLaborToPlannerMembers(result.allocatable);
    const plan = planFlatBayAssignments(
      Array.from({ length: 3 }, (_, i) => bay(`r${i}`)),
      members,
      { knownHoursOnly: true }
    );
    expect(plan.items).toHaveLength(3);
  });

  it("Supervisor participates; Master excluded", () => {
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: "2026-W38",
      dates: ["2026-09-15"],
      workforce: [
        {
          id: "sup",
          name: "S",
          role: "Supervisor",
          is_active: true,
          home_department: "flooring",
        },
        {
          id: "mas",
          name: "M",
          role: "MasterAdmin",
          is_active: true,
          home_department: "flooring",
        },
      ],
      persisted_shift_days: [
        {
          specialist_id: "sup",
          work_date: "2026-09-15",
          start_time: "07:00",
          end_time: "15:00",
          is_scheduled_today: true,
          is_call_out: false,
          status: "ON_DUTY",
        },
        {
          specialist_id: "mas",
          work_date: "2026-09-15",
          start_time: "07:00",
          end_time: "15:00",
          is_scheduled_today: true,
          is_call_out: false,
          status: "ON_DUTY",
        },
      ],
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: "2026-09-15T12:00:00.000Z",
    });
    expect(result.allocatable.map((m) => m.specialist_id)).toEqual(["sup"]);
  });
});

describe("ENGINE-PROD-002 physical-bay integrity", () => {
  it("sibling surfaces share one physical key", () => {
    const dept = "dept-1";
    expect(
      physicalBayKey({ department_id: dept, aisle: "41", bay: 11 })
    ).toBe(physicalBayKey({ department_id: dept, aisle: "41", bay: 11 }));
    const plan = planFlatBayAssignments(
      Array.from({ length: 12 }, (_, i) => bay(`r${i}`, "41", i + 1)),
      [member("a", 40), member("b", 40), member("c", 40), member("d", 40)],
      { knownHoursOnly: true }
    );
    const keys = new Set(
      plan.items.map((item) => `${item.aisle}|${item.bay}`)
    );
    expect(keys.size).toBe(12);
  });
});

describe("ENGINE-PROD-002 cron-compatible Sunday gate", () => {
  it("opens at default window when configured 23:59 is unreachable by 11:00 UTC cron", () => {
    // Sunday 2026-09-13 11:00 UTC = 05:00 America/Denver
    const now = new Date("2026-09-13T11:00:00.000Z");
    const decision = evaluateSundayAutoRun(
      {
        timezone: "America/Denver",
        sunday_auto_generate: true,
        sunday_auto_stage_time: "23:59:00",
      },
      now
    );
    expect(decision.run).toBe(true);
    if (decision.run) {
      expect(decision.reason).toMatch(/Cron-compatible window/i);
    }
  });

  it("still skips before default stage time", () => {
    const now = new Date("2026-09-13T10:00:00.000Z"); // 04:00 Denver
    const decision = evaluateSundayAutoRun(
      {
        timezone: "America/Denver",
        sunday_auto_generate: true,
        sunday_auto_stage_time: "23:59:00",
      },
      now
    );
    expect(decision.run).toBe(false);
  });

  it("keeps configured early stage time when already past it", () => {
    const now = new Date("2026-09-13T11:00:00.000Z");
    const decision = evaluateSundayAutoRun(
      {
        timezone: "America/Denver",
        sunday_auto_generate: true,
        sunday_auto_stage_time: "04:00",
      },
      now
    );
    expect(decision.run).toBe(true);
  });
});

describe("ENGINE-PROD-002 source contracts", () => {
  it("cron invokes Stage+Assign orchestration, not stage-only generate", () => {
    const rotations = readRepo("lib/store-ops/rotations.ts");
    expect(rotations).toMatch(/runSundayDispatchForAllDepartments/);
    expect(rotations).toMatch(/dispatch_status/);
    const cron = readRepo("app/api/cron/weekly-rotation/route.ts");
    expect(cron).toMatch(/bays_owned/);
    expect(cron).toMatch(/Stage\+Assign/);
  });

  it("sunday-dispatch owns flat quota and admin assignment writer", () => {
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(dispatch).toMatch(/BASE_WEEKLY_BAY_QUOTA/);
    expect(dispatch).toMatch(/planFlatBayAssignmentsWithCaps/);
    expect(dispatch).toMatch(/applySundayAssignmentPlanAdmin/);
    expect(dispatch).toMatch(/ALREADY_COMPLETE/);
    expect(dispatch).toMatch(/INCOMPLETE_SCHEDULE/);
    expect(dispatch).toMatch(/INSUFFICIENT_BAYS/);
    expect(dispatch).not.toMatch(/planProportionalBayAssignments/);
    expect(dispatch).not.toMatch(/\blocalStorage\b/);
    expect(dispatch).not.toMatch(/DEFAULT_SHIFT_HOURS/);
  });

  it("recovery Assign this week uses flat quota, call-out keeps proportional", () => {
    const modal = readRepo("components/admin/SundayAuditAssignmentModal.tsx");
    expect(modal).toMatch(/planFlatBayAssignments/);
    expect(modal).toMatch(/BASE_WEEKLY_BAY_QUOTA/);
    const callOut = readRepo("lib/store-ops/call-out.ts");
    expect(callOut).toMatch(/planProportionalBayAssignments/);
  });

  it("does not implement seasonal selector or Floor Pad / Gemini changes", () => {
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(dispatch).not.toMatch(/operational_context|seasonal|gemini/i);
    const physical = readRepo("lib/store-ops/physical-bay.ts");
    expect(physical).not.toMatch(/operational_context/);
  });

  it("idempotency prefers reuse over redraw", () => {
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(dispatch).toMatch(/planIsComplete/);
    expect(dispatch).toMatch(/ALREADY_COMPLETE/);
    expect(dispatch).toMatch(/skipIfExists: !options\.forceOverwrite/);
    expect(dispatch).toMatch(/refusing destructive rewrite/);
  });
});

describe("ENGINE-PROD-002 insufficient-labor decision (documented)", () => {
  it("uses strict 3 for all known-hours > 0 — no invented minimum threshold", () => {
    // CAP-001 rejected capacity; no Planning Allowance exists.
    const plan = planFlatBayAssignments(
      Array.from({ length: 3 }, (_, i) => bay(`r${i}`)),
      [member("short", 4)],
      { knownHoursOnly: true }
    );
    expect(plan.loads[0]?.quota).toBe(3);
    expect(plan.items).toHaveLength(3);
  });
});
