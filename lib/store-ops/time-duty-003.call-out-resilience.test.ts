/**
 * TIME-DUTY-003 — call-out preserves weekly ownership; next opportunity is derived.
 *
 * Default call-out is availability evidence only. Pool/auto/carry stay explicit.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  composeCurrentAvailability,
  isScheduledNow,
} from "./current-availability";
import {
  composeNextScheduledOpportunity,
  countWeeklyOwnership,
  isoWeekLabelFromStoreDate,
} from "./next-opportunity";
import { composeOnDutyBayWorkload } from "./weekly-rotations";
import { composeWeekLaborAvailability } from "./labor-availability";
import { isoWeekCalendarRange } from "./week";
import { physicalBayKey } from "./physical-bay";

const root = path.resolve(__dirname, "../..");
const TZ = "America/Denver";

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function denver(isoUtc: string): Date {
  return new Date(isoUtc);
}

/** Tuesday 2026-09-15 10:00 America/Denver. */
const TUE_1000 = denver("2026-09-15T16:00:00.000Z");
/** Thursday 2026-09-17 10:00 America/Denver. */
const THU_1000 = denver("2026-09-17T16:00:00.000Z");
/** Thursday 09:59 America/Denver. */
const THU_0959 = denver("2026-09-17T15:59:00.000Z");

function tuesdayCallOut() {
  return {
    work_date: "2026-09-15",
    start_time: "08:00",
    end_time: "16:30",
    is_scheduled_today: true,
    is_call_out: true,
    status: "ABSENT_CALLOUT" as const,
  };
}

function thursdayShift() {
  return {
    work_date: "2026-09-17",
    start_time: "10:00",
    end_time: "18:30",
    is_scheduled_today: true,
    is_call_out: false,
    status: "ON_DUTY" as const,
  };
}

describe("default call-out vs ownership", () => {
  const bays = [
    { rotationId: "r11", aisle: "41", bay: 11, riskScore: 0 },
    { rotationId: "r15", aisle: "41", bay: 15, riskScore: 0 },
    { rotationId: "r19", aisle: "41", bay: 19, riskScore: 0 },
  ];
  const assignments = {
    r11: { specialist_id: "sarah" },
    r15: { specialist_id: "sarah" },
    r19: { specialist_id: "sarah" },
  };

  it("Tuesday call-out is Called out and not On now", () => {
    const result = composeCurrentAvailability({
      row: tuesdayCallOut(),
      now: TUE_1000,
      timeZone: TZ,
    });
    expect(result.reason).toBe("CALLED_OUT");
    expect(result.label).toBe("Called out");
    expect(isScheduledNow(result)).toBe(false);
  });

  it("Sarah still owns three physical bays after call-out with empty On now set", () => {
    const after = composeOnDutyBayWorkload({
      bays,
      assignments,
      onDuty: [],
    });
    expect(after.groups).toEqual([]);
    expect(after.assigneeByRotationId).toEqual({
      r11: "sarah",
      r15: "sarah",
      r19: "sarah",
    });
    expect(after.unassignedIds).toEqual([]);
    expect(countWeeklyOwnership(assignments, "sarah")).toBe(3);
  });

  it("one owned unit remains one physical bay", () => {
    expect(
      physicalBayKey({ department_id: "dept-1", aisle: "41", bay: 11 })
    ).toBe("dept-1|41|11");
  });
});

describe("next scheduled opportunity", () => {
  it("Tuesday call-out + Thursday valid shift derives Thursday without persisting", () => {
    const result = composeNextScheduledOpportunity({
      rows: [tuesdayCallOut(), thursdayShift()],
      now: TUE_1000,
      timeZone: TZ,
    });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.work_date).toBe("2026-09-17");
    expect(result.start_time).toBe("10:00");
    expect(result.caption).toBe("Next scheduled: Thu 10:00 AM");
    expect(result.method).toBe("schedule-derived-next-opportunity-v1");
    const source = readRepo("lib/store-ops/next-opportunity.ts");
    expect(source).not.toMatch(/upsertShiftDay|applySundayAssignmentPlan/);
  });

  it("no later valid current-week shift reports none and does not redistribute", () => {
    const result = composeNextScheduledOpportunity({
      rows: [tuesdayCallOut()],
      now: TUE_1000,
      timeZone: TZ,
    });
    expect(result.found).toBe(false);
    expect(result.caption).toBe("No remaining scheduled shift this week");
  });

  it("missing/invalid/OFF future rows do not invent an opportunity or 8h window", () => {
    const missing = composeNextScheduledOpportunity({
      rows: [
        tuesdayCallOut(),
        {
          work_date: "2026-09-17",
          start_time: null,
          end_time: null,
          is_scheduled_today: true,
          is_call_out: false,
          status: "ON_DUTY",
        },
      ],
      now: TUE_1000,
      timeZone: TZ,
    });
    expect(missing.found).toBe(false);

    const off = composeNextScheduledOpportunity({
      rows: [
        tuesdayCallOut(),
        {
          work_date: "2026-09-17",
          start_time: "10:00",
          end_time: "18:30",
          is_scheduled_today: false,
          is_call_out: false,
          status: "OFF",
        },
      ],
      now: TUE_1000,
      timeZone: TZ,
    });
    expect(off.found).toBe(false);

    const source = readRepo("lib/store-ops/next-opportunity.ts");
    expect(source).not.toMatch(/DEFAULT_SHIFT_HOURS|DEFAULT_START|07:00|15:30/);
  });

  it("uses store-local ISO week, not device getters, as the search bound", () => {
    expect(isoWeekLabelFromStoreDate("2026-09-15")).toBe("2026-W38");
    const range = isoWeekCalendarRange("2026-W38");
    expect(range.dates[0]).toBe("2026-09-14");
    expect(range.dates[6]).toBe("2026-09-20");
    const source = readRepo("lib/store-ops/next-opportunity.ts");
    expect(source).toMatch(/storeLocalWorkDate/);
    expect(source).not.toMatch(/\blocalWorkDate\(/);
  });
});

describe("future shift restoration", () => {
  it("Thursday start becomes On now without clearing Tuesday call-out", () => {
    const thursday = composeCurrentAvailability({
      row: thursdayShift(),
      previousDay: tuesdayCallOut(),
      now: THU_1000,
      timeZone: TZ,
    });
    expect(thursday.state).toBe("SCHEDULED_NOW");
    expect(thursday.label).toBe("On now");

    const before = composeCurrentAvailability({
      row: thursdayShift(),
      previousDay: tuesdayCallOut(),
      now: THU_0959,
      timeZone: TZ,
    });
    expect(before.state).toBe("LATER_TODAY");

    const tuesdayStill = composeCurrentAvailability({
      row: tuesdayCallOut(),
      now: TUE_1000,
      timeZone: TZ,
    });
    expect(tuesdayStill.reason).toBe("CALLED_OUT");
  });
});

describe("mounted contract", () => {
  it("default Roster call-out persists evidence without rebalance", () => {
    const roster = readRepo("components/hub/tabs/RosterTab.tsx");
    expect(roster).toMatch(/async function recordCallOut/);
    const recordAt = roster.indexOf("async function recordCallOut");
    const reassignAt = roster.indexOf("async function applyReassign");
    expect(recordAt).toBeGreaterThan(-1);
    expect(reassignAt).toBeGreaterThan(recordAt);
    const recordFn = roster.slice(recordAt, reassignAt);
    expect(recordFn).toMatch(/is_call_out:\s*true/);
    expect(recordFn).toMatch(/upsertShiftDay/);
    expect(recordFn).not.toMatch(/redistributeCallOutBays/);
    expect(recordFn).not.toMatch(/applySundayAssignmentPlan/);
    expect(recordFn).not.toMatch(/clearSundayBayAssignment/);
    expect(recordFn).not.toMatch(/markSundayBaysCarriedOver/);
  });

  it("optional reassign remains explicit and reuses existing pool/auto/carry", () => {
    const roster = readRepo("components/hub/tabs/RosterTab.tsx");
    const reassignAt = roster.indexOf("async function applyReassign");
    const reassignFn = roster.slice(reassignAt, reassignAt + 1200);
    expect(reassignFn).toMatch(/redistributeCallOutBays/);
    expect(readRepo("components/hub/SpecialistCard.tsx")).toMatch(
      /roster-reassign-recovery/
    );
    expect(readRepo("components/hub/SpecialistEditSheet.tsx")).toMatch(
      /Reassign bays \(recovery\)/
    );
    expect(roster).toMatch(/setReassignTarget/);
    expect(roster).toMatch(/composeNextScheduledOpportunity/);
    expect(roster).not.toMatch(/Attendance|no-show|Missed work|Failed shift/i);

    const callOut = readRepo("lib/store-ops/call-out.ts");
    expect(callOut).toMatch(/mode === "pool"/);
    expect(callOut).toMatch(/mode === "carry"/);
    expect(callOut).toMatch(/knownHoursOnly: true/);
  });

  it("Floor keeps called-out owners out of On now without hiding owned bays", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).toMatch(/isScheduledNow/);
    expect(floor).toMatch(/composeOnDutyBayWorkload/);
    expect(floor).not.toMatch(/recordCallOut|redistributeCallOutBays/);
  });

  it("normal shift end is still unrelated to call-out writers", () => {
    const availability = readRepo("lib/store-ops/current-availability.ts");
    const tick = readRepo("lib/store-ops/use-store-clock.ts");
    expect(availability).not.toMatch(/upsertShiftDay|redistributeCallOutBays/);
    expect(tick).not.toMatch(/upsertShiftDay|redistributeCallOutBays/);
  });

  it("week-boundary reclaim still does not silently complete coverage", () => {
    const rotations = readRepo("lib/store-ops/rotations.ts");
    expect(rotations).toMatch(/export async function reclaimStaleAssignments/);
    const reclaimAt = rotations.indexOf(
      "export async function reclaimStaleAssignments"
    );
    const reclaim = rotations.slice(reclaimAt, reclaimAt + 2200);
    expect(reclaim).toMatch(/status", "ASSIGNED"/);
    expect(reclaim).not.toMatch(/VERIFIED_COMPLETE|is_completed:\s*true/);
    const roster = readRepo("components/hub/tabs/RosterTab.tsx");
    const recordAt = roster.indexOf("async function recordCallOut");
    const recordFn = roster.slice(
      recordAt,
      roster.indexOf("async function applyReassign")
    );
    expect(recordFn).not.toMatch(/is_completed|VERIFIED_COMPLETE|COMPLETED/);
  });

  it("no schema, attendance model, or invented labor", () => {
    const next = readRepo("lib/store-ops/next-opportunity.ts");
    expect(next).not.toMatch(/is_on_shift|preserve_ownership|callout_policy/);
    const migrations = fs.readdirSync(path.join(root, "supabase/migrations"));
    expect(
      migrations.some((name) =>
        /next_shift|next_opportunity|callout_policy|attendance/i.test(name)
      )
    ).toBe(false);
    const labor = readRepo("lib/store-ops/labor-availability.ts");
    expect(labor).not.toMatch(/composeNextScheduledOpportunity/);
    expect(labor).toMatch(/export function composeWeekLaborAvailability/);
  });

  it("protected surfaces stay off this tranche", () => {
    expect(
      readRepo("components/dashboard/TacticalVoiceFloorPad.tsx")
    ).not.toMatch(/composeNextScheduledOpportunity|recordCallOut/);
    expect(readRepo("lib/store-ops/operational-context.ts")).not.toMatch(
      /composeNextScheduledOpportunity/
    );
    expect(readRepo("lib/ai/gemini.ts")).not.toMatch(
      /composeNextScheduledOpportunity/
    );
  });
});

describe("LAB-WEEK-002 still allocatable after an off/call-out day", () => {
  it("later-week known hours remain allocatable", () => {
    const WEEK = "2026-W12";
    const range = isoWeekCalendarRange(WEEK);
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: [
        {
          id: "a",
          role: "Associate",
          is_active: true,
          home_department: "flooring",
          assigned_department: "flooring",
          name: "A",
        },
      ],
      persisted_shift_days: [
        {
          specialist_id: "a",
          work_date: range.dates[0]!,
          start_time: "08:00",
          end_time: "16:30",
          is_scheduled_today: true,
          is_call_out: true,
          status: "ABSENT_CALLOUT",
        },
        {
          specialist_id: "a",
          work_date: range.dates[3]!,
          start_time: "10:00",
          end_time: "18:30",
          is_scheduled_today: true,
          is_call_out: false,
          status: "ON_DUTY",
        },
      ],
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: "2026-03-16T12:00:00.000Z",
    });
    expect(result.members[0]!.has_allocatable_hours).toBe(true);
    expect(result.members[0]!.known_available_hours).toBe(8.5);
  });
});

describe("explicit redistribute helpers remain importable", () => {
  it("lab-week call-out suite still owns auto algorithm tests", () => {
    const source = readRepo("lib/store-ops/lab-week-002.call-out.test.ts");
    expect(source).toMatch(/redistributeCallOutBays/);
    expect(source).toMatch(/mode: "auto"/);
  });
});
