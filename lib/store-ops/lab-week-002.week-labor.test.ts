/**
 * LAB-WEEK-002 — whole-week labor composition + week boundary.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  composeWeekLaborAvailability,
  weekLaborToPlannerMembers,
  type LabPersistedShiftDayInput,
  type WeekLaborMemberInput,
} from "./labor-availability";
import { isoWeekCalendarRange, isoWeekToMondayDate } from "./week";

const AS_OF = "2026-03-16T12:00:00.000Z";
const WEEK = "2026-W12";

function member(
  id: string,
  opts: Partial<WeekLaborMemberInput> = {}
): WeekLaborMemberInput {
  return {
    id,
    role: "Associate",
    is_active: true,
    home_department: "flooring",
    assigned_department: "flooring",
    name: opts.name ?? id,
    ...opts,
  };
}

function onDuty(
  specialist_id: string,
  work_date: string,
  start = "07:00",
  end = "15:00"
): LabPersistedShiftDayInput {
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

function off(specialist_id: string, work_date: string): LabPersistedShiftDayInput {
  return {
    specialist_id,
    work_date,
    start_time: null,
    end_time: null,
    is_scheduled_today: false,
    is_call_out: false,
    status: "OFF",
  };
}

function callOut(
  specialist_id: string,
  work_date: string,
  start: string | null = "07:00",
  end: string | null = "15:00"
): LabPersistedShiftDayInput {
  return {
    specialist_id,
    work_date,
    start_time: start,
    end_time: end,
    is_scheduled_today: true,
    is_call_out: true,
    status: "ABSENT_CALLOUT",
  };
}

function unknownDuration(
  specialist_id: string,
  work_date: string
): LabPersistedShiftDayInput {
  return {
    specialist_id,
    work_date,
    start_time: null,
    end_time: null,
    is_scheduled_today: true,
    is_call_out: false,
    status: "ON_DUTY",
  };
}

describe("LAB-WEEK-002 iso week boundary", () => {
  it("assigned_week Monday through following Sunday matches week_starting ownership week", () => {
    const monday = isoWeekToMondayDate(WEEK);
    const range = isoWeekCalendarRange(WEEK);
    expect(monday).toBe("2026-03-16");
    expect(range.startDate).toBe("2026-03-16");
    expect(range.endDate).toBe("2026-03-22");
    expect(range.dates).toEqual([
      "2026-03-16",
      "2026-03-17",
      "2026-03-18",
      "2026-03-19",
      "2026-03-20",
      "2026-03-21",
      "2026-03-22",
    ]);
    // Sunday (retail week start) is the LAST day of the ISO assignment week, not the first.
    expect(range.dates[0]).not.toBe("2026-03-15");
    expect(range.dates[6]).toBe("2026-03-22");
  });
});

describe("composeWeekLaborAvailability", () => {
  const range = isoWeekCalendarRange(WEEK);

  it("person scheduled Wed–Sat still accumulates weekly known hours (not Monday-only)", () => {
    const days = [
      onDuty("later", "2026-03-18"),
      onDuty("later", "2026-03-19"),
      onDuty("later", "2026-03-20"),
      onDuty("later", "2026-03-21"),
    ];
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: [member("later", { name: "Later Worker" })],
      persisted_shift_days: days,
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: AS_OF,
    });
    const row = result.members.find((m) => m.specialist_id === "later")!;
    expect(row.known_available_hours).toBe(32); // 4 × 8h
    expect(row.missing_day_count).toBe(3); // Mon, Tue, Sun missing ≠ OFF
    expect(row.has_allocatable_hours).toBe(true);
  });

  it("equal schedule hours across four people", () => {
    const ids = ["a", "b", "c", "d"];
    const days = ids.flatMap((id) =>
      range.dates.slice(0, 5).map((d) => onDuty(id, d))
    );
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: ids.map((id) => member(id)),
      persisted_shift_days: days,
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: AS_OF,
    });
    expect(result.allocatable.map((m) => m.known_available_hours)).toEqual([
      40, 40, 40, 40,
    ]);
  });

  it("unequal schedule hours", () => {
    const days = [
      ...range.dates.slice(0, 5).map((d) => onDuty("a", d)), // 40
      ...range.dates.slice(0, 4).map((d) => onDuty("b", d)), // 32
      ...range.dates.slice(0, 2).map((d) => onDuty("c", d)), // 16
      onDuty("d", range.dates[0]!, "07:00", "11:00"), // 4
    ];
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: ["a", "b", "c", "d"].map((id) => member(id)),
      persisted_shift_days: days,
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: AS_OF,
    });
    const byId = Object.fromEntries(
      result.allocatable.map((m) => [m.specialist_id, m.known_available_hours])
    );
    expect(byId).toEqual({ a: 40, b: 32, c: 16, d: 4 });
  });

  it("explicit OFF contributes zero hours for that day", () => {
    const days = [
      onDuty("a", "2026-03-16"),
      off("a", "2026-03-17"),
      onDuty("a", "2026-03-18"),
    ];
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: [member("a")],
      persisted_shift_days: days,
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: AS_OF,
    });
    expect(result.members[0]!.known_available_hours).toBe(16);
    expect(result.members[0]!.off_day_count).toBe(1);
  });

  it("call-out day is not available for allocation", () => {
    const days = [
      onDuty("a", "2026-03-16"),
      callOut("a", "2026-03-17"),
      onDuty("a", "2026-03-18"),
    ];
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: [member("a")],
      persisted_shift_days: days,
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: AS_OF,
    });
    expect(result.members[0]!.known_available_hours).toBe(16);
    expect(result.members[0]!.callout_day_count).toBe(1);
  });

  it("scheduled with unknown times does not invent 8 hours", () => {
    const days = [unknownDuration("a", "2026-03-16"), onDuty("a", "2026-03-17")];
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: [member("a")],
      persisted_shift_days: days,
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: AS_OF,
    });
    expect(result.members[0]!.known_available_hours).toBe(8);
    expect(result.members[0]!.unknown_duration_day_count).toBe(1);
    expect(result.processing_status).toBe("PARTIAL");
  });

  it("missing row is neither OFF nor ON_DUTY", () => {
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: [member("a")],
      persisted_shift_days: [onDuty("a", "2026-03-16")],
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: AS_OF,
    });
    expect(result.members[0]!.missing_day_count).toBe(6);
    expect(result.members[0]!.off_day_count).toBe(0);
    expect(result.members[0]!.known_available_hours).toBe(8);
  });

  it("partial week still allocates from known hours only", () => {
    const days = [onDuty("a", "2026-03-16"), onDuty("b", "2026-03-16")];
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: [member("a"), member("b")],
      persisted_shift_days: days,
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: AS_OF,
    });
    expect(result.allocatable).toHaveLength(2);
    expect(result.processing_status).toBe("PARTIAL");
  });

  it("Master Admin excluded from labor", () => {
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: [
        member("boss", { role: "MasterAdmin", home_department: "all" }),
        member("a"),
      ],
      persisted_shift_days: [
        onDuty("boss", "2026-03-16"),
        onDuty("a", "2026-03-16"),
      ],
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: AS_OF,
    });
    expect(result.members.map((m) => m.specialist_id)).toEqual(["a"]);
  });

  it("wrong home department excluded", () => {
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: [
        member("appl", { home_department: "appliances", assigned_department: "appliances" }),
        member("floor"),
      ],
      persisted_shift_days: [
        onDuty("appl", "2026-03-16"),
        onDuty("floor", "2026-03-16"),
      ],
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: AS_OF,
    });
    expect(result.members.map((m) => m.specialist_id)).toEqual(["floor"]);
  });

  it("department access alone does not create labor", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "labor-availability.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/canAccessDepartment/);
    // Behavioral: appliances home never enters flooring allocatable set.
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: [
        member("guest", {
          home_department: "appliances",
          assigned_department: "appliances",
          name: "Guest",
        }),
      ],
      persisted_shift_days: [onDuty("guest", "2026-03-16")],
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: AS_OF,
    });
    expect(result.members).toEqual([]);
    expect(result.allocatable).toEqual([]);
  });

  it("weekLaborToPlannerMembers drops zero-hour members", () => {
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: [member("a"), member("b")],
      persisted_shift_days: [onDuty("a", "2026-03-16"), off("b", "2026-03-16")],
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: AS_OF,
    });
    expect(weekLaborToPlannerMembers(result.allocatable)).toEqual([
      {
        specialist_id: "a",
        specialist_name: "a",
        active: true,
        hours: 8,
      },
    ]);
  });

  it("UNAVAILABLE when schedule evidence missing — does not invent empty success", () => {
    const result = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: [member("a")],
      persisted_shift_days: [],
      workforce_evidence_available: true,
      schedule_evidence_available: false,
      as_of: AS_OF,
    });
    expect(result.processing_status).toBe("UNAVAILABLE");
    expect(result.allocatable).toEqual([]);
  });
});
