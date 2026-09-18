/**
 * TIME-DUTY-002 — schedule-derived current expected availability.
 *
 * Persist evidence. Derive On now / Later today / Off from store-local time.
 * Not punch/attendance. Clock passage must not mutate weekly ownership.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  composeCurrentAvailability,
  isLaterToday,
  isScheduledNow,
  previousStoreLocalWorkDate,
  storeLocalWorkDate,
  type CurrentAvailabilityShiftInput,
} from "./current-availability";
import { composeOnDutyBayWorkload } from "./weekly-rotations";
import { composeWeekLaborAvailability } from "./labor-availability";
import { isoWeekCalendarRange } from "./week";
import { physicalBayKey } from "./physical-bay";

const root = path.resolve(__dirname, "../..");
const TZ = "America/Denver";

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

/** 2026-09-16 in America/Denver (MDT, UTC-6). */
function denver(isoUtc: string): Date {
  return new Date(isoUtc);
}

const AT_0759 = denver("2026-09-16T13:59:00.000Z");
const AT_0800 = denver("2026-09-16T14:00:00.000Z");
const AT_1629 = denver("2026-09-16T22:29:00.000Z");
const AT_1630 = denver("2026-09-16T22:30:00.000Z");

function scheduled(overrides: Partial<CurrentAvailabilityShiftInput> = {}) {
  return {
    work_date: "2026-09-16",
    start_time: "08:00",
    end_time: "16:30",
    is_scheduled_today: true,
    is_call_out: false,
    status: "ON_DUTY",
    ...overrides,
  };
}

describe("schedule window", () => {
  it("07:59 → LATER_TODAY; 08:00 → SCHEDULED_NOW; 16:29 → SCHEDULED_NOW; 16:30 → AFTER_SHIFT", () => {
    const row = scheduled();
    const before = composeCurrentAvailability({ row, now: AT_0759, timeZone: TZ });
    expect(before.state).toBe("LATER_TODAY");
    expect(before.reason).toBe("BEFORE_SHIFT");
    expect(before.label).toBe("Later today");

    const start = composeCurrentAvailability({ row, now: AT_0800, timeZone: TZ });
    expect(start.state).toBe("SCHEDULED_NOW");
    expect(start.label).toBe("On now");
    expect(isScheduledNow(start)).toBe(true);

    const late = composeCurrentAvailability({ row, now: AT_1629, timeZone: TZ });
    expect(late.state).toBe("SCHEDULED_NOW");

    const ended = composeCurrentAvailability({ row, now: AT_1630, timeZone: TZ });
    expect(ended.state).toBe("OFF");
    expect(ended.reason).toBe("AFTER_SHIFT");
    expect(ended.label).toBe("Off");
    expect(isScheduledNow(ended)).toBe(false);
  });
});

describe("explicit OFF and call-out", () => {
  it("OFF row never becomes On now even inside the clock window", () => {
    const result = composeCurrentAvailability({
      row: scheduled({ is_scheduled_today: false, status: "OFF" }),
      now: AT_0800,
      timeZone: TZ,
    });
    expect(result.state).toBe("OFF");
    expect(result.reason).toBe("OFF_TODAY");
    expect(isScheduledNow(result)).toBe(false);
  });

  it("call-out inside the scheduled window is never On now", () => {
    const result = composeCurrentAvailability({
      row: scheduled({ is_call_out: true, status: "ABSENT_CALLOUT" }),
      now: AT_0800,
      timeZone: TZ,
    });
    expect(result.state).toBe("OFF");
    expect(result.reason).toBe("CALLED_OUT");
    expect(result.label).toBe("Called out");
  });
});

describe("missing and invalid evidence", () => {
  it("missing schedule row never becomes On now and labels Schedule unknown", () => {
    const result = composeCurrentAvailability({
      row: null,
      now: AT_0800,
      timeZone: TZ,
    });
    expect(isScheduledNow(result)).toBe(false);
    expect(result.reason).toBe("UNKNOWN");
    expect(result.label).toBe("Schedule unknown");
    expect(result.label).not.toBe("On now");
    expect(result.label).not.toBe("Off");
  });

  it("scheduled row with null clocks does not invent a shift or On now", () => {
    const result = composeCurrentAvailability({
      row: scheduled({ start_time: null, end_time: null }),
      now: AT_0800,
      timeZone: TZ,
    });
    expect(isScheduledNow(result)).toBe(false);
    expect(result.reason).toBe("UNKNOWN");
    expect(result.label).toBe("Schedule unknown");
  });

  it("does not treat missing evidence as explicit OFF_TODAY", () => {
    const missing = composeCurrentAvailability({
      row: undefined,
      now: AT_0800,
      timeZone: TZ,
    });
    expect(missing.reason).toBe("UNKNOWN");
    expect(missing.reason).not.toBe("OFF_TODAY");
  });
});

describe("store timezone authority", () => {
  it("same instant yields different duty state across store timezones", () => {
    const instant = new Date("2026-09-16T12:00:00.000Z");
    const row = scheduled();
    const denver = composeCurrentAvailability({
      row,
      now: instant,
      timeZone: "America/Denver",
    });
    const york = composeCurrentAvailability({
      row,
      now: instant,
      timeZone: "America/New_York",
    });
    expect(storeLocalWorkDate(instant, "America/Denver")).toBe("2026-09-16");
    expect(denver.state).toBe("LATER_TODAY");
    expect(york.state).toBe("SCHEDULED_NOW");
  });

  it("falls back through normalizeStoreTimezone rather than device getters", () => {
    const source = readRepo("lib/store-ops/current-availability.ts");
    expect(source).toMatch(/zonedParts/);
    expect(source).toMatch(/normalizeStoreTimezone/);
    expect(source).not.toMatch(/getHours\(\)/);
    expect(source).not.toMatch(/localWorkDate/);
  });
});

describe("overnight wrap", () => {
  const overnight = scheduled({
    start_time: "22:00",
    end_time: "06:00",
  });

  it("23:00 on the work date is On now (wrap is not already ended)", () => {
    const at2300 = denver("2026-09-17T05:00:00.000Z");
    const result = composeCurrentAvailability({
      row: overnight,
      now: at2300,
      timeZone: TZ,
    });
    expect(storeLocalWorkDate(at2300, TZ)).toBe("2026-09-16");
    expect(result.state).toBe("SCHEDULED_NOW");
  });

  it("02:00 on the work date is Later today, not a false morning On now", () => {
    const at0200 = denver("2026-09-16T08:00:00.000Z");
    const result = composeCurrentAvailability({
      row: overnight,
      now: at0200,
      timeZone: TZ,
    });
    expect(storeLocalWorkDate(at0200, TZ)).toBe("2026-09-16");
    expect(result.state).toBe("LATER_TODAY");
    expect(isLaterToday(result)).toBe(true);
  });

  it("post-midnight continuation uses yesterday's wrap row when supplied", () => {
    const at0200Next = denver("2026-09-17T08:00:00.000Z");
    expect(storeLocalWorkDate(at0200Next, TZ)).toBe("2026-09-17");
    expect(previousStoreLocalWorkDate(at0200Next, TZ)).toBe("2026-09-16");
    const result = composeCurrentAvailability({
      row: scheduled({
        work_date: "2026-09-17",
        is_scheduled_today: false,
        status: "OFF",
        start_time: null,
        end_time: null,
      }),
      previousDay: overnight,
      now: at0200Next,
      timeZone: TZ,
    });
    expect(result.state).toBe("SCHEDULED_NOW");
  });

  it("post-midnight without yesterday's row does not invent On now", () => {
    const at0200Next = denver("2026-09-17T08:00:00.000Z");
    const result = composeCurrentAvailability({
      row: null,
      now: at0200Next,
      timeZone: TZ,
    });
    expect(isScheduledNow(result)).toBe(false);
    expect(result.reason).toBe("UNKNOWN");
  });

  it("today's call-out overrides yesterday overnight continuation", () => {
    const at0200Next = denver("2026-09-17T08:00:00.000Z");
    const result = composeCurrentAvailability({
      row: scheduled({
        work_date: "2026-09-17",
        is_call_out: true,
        status: "ABSENT_CALLOUT",
      }),
      previousDay: overnight,
      now: at0200Next,
      timeZone: TZ,
    });
    expect(isScheduledNow(result)).toBe(false);
    expect(result.reason).toBe("CALLED_OUT");
  });

  it("after overnight wrap end, yesterday's row is not On now", () => {
    const at0700 = denver("2026-09-17T13:00:00.000Z");
    expect(storeLocalWorkDate(at0700, TZ)).toBe("2026-09-17");
    const result = composeCurrentAvailability({
      row: scheduled({
        work_date: "2026-09-17",
        is_scheduled_today: false,
        status: "OFF",
        start_time: null,
        end_time: null,
      }),
      previousDay: overnight,
      now: at0700,
      timeZone: TZ,
    });
    expect(isScheduledNow(result)).toBe(false);
    expect(result.reason).toBe("OFF_TODAY");
  });
});

describe("store-local work date", () => {
  it("the same instant selects different shift days by store timezone", () => {
    const instant = new Date("2026-09-17T05:30:00.000Z");
    const evening = scheduled({
      work_date: "2026-09-16",
      start_time: "22:00",
      end_time: "23:45",
    });
    expect(storeLocalWorkDate(instant, "America/Denver")).toBe("2026-09-16");
    expect(storeLocalWorkDate(instant, "America/New_York")).toBe("2026-09-17");
    const denverResult = composeCurrentAvailability({
      row: evening,
      now: instant,
      timeZone: "America/Denver",
    });
    const yorkResult = composeCurrentAvailability({
      row: evening,
      now: instant,
      timeZone: "America/New_York",
    });
    expect(denverResult.state).toBe("SCHEDULED_NOW");
    expect(isScheduledNow(yorkResult)).toBe(false);
    expect(yorkResult.reason).toBe("UNKNOWN");
  });
});

describe("clock passage vs weekly ownership", () => {
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
  const sarah = {
    specialist_id: "sarah",
    specialist_name: "Sarah",
    hours: 8.5,
    start: "08:00",
    end: "16:30",
  };

  it("16:29 On now still groups owned bays; 16:30 Off keeps ownership", () => {
    const onNow = composeOnDutyBayWorkload({
      bays,
      assignments,
      onDuty: [sarah],
    });
    expect(onNow.groups[0]?.rotationIds).toEqual(["r11", "r15", "r19"]);
    expect(onNow.assigneeByRotationId).toEqual({
      r11: "sarah",
      r15: "sarah",
      r19: "sarah",
    });

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
  });

  it("clock helpers do not write assignments or schedules", () => {
    const availability = readRepo("lib/store-ops/current-availability.ts");
    const tick = readRepo("lib/store-ops/use-store-clock.ts");
    expect(availability).not.toMatch(/upsertShiftDay|applySundayAssignmentPlan|sunday_bay_assignments/);
    expect(tick).not.toMatch(/upsertShiftDay|fetchShiftDays|applySundayAssignmentPlan/);
    expect(tick).toMatch(/visibilitychange/);
    expect(tick).toMatch(/setInterval/);
  });
});

describe("weekly allocation safety", () => {
  it("OFF today with later-week hours remains allocatable", () => {
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
          is_scheduled_today: false,
          is_call_out: false,
          status: "OFF",
        },
        {
          specialist_id: "a",
          work_date: range.dates[3]!,
          start_time: "08:00",
          end_time: "16:30",
          is_scheduled_today: true,
          is_call_out: false,
          status: "ON_DUTY",
        },
      ],
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: "2026-03-16T12:00:00.000Z",
    });
    expect(result.members[0]!.off_day_count).toBe(1);
    expect(result.members[0]!.known_available_hours).toBe(8.5);
    expect(result.members[0]!.has_allocatable_hours).toBe(true);
  });

  it("labor composer is unchanged by current-availability", () => {
    const labor = readRepo("lib/store-ops/labor-availability.ts");
    expect(labor).not.toMatch(/composeCurrentAvailability/);
    expect(labor).toMatch(/export function composeWeekLaborAvailability/);
  });
});

describe("physical bay + mounted consumers", () => {
  it("one owned unit remains one physical bay", () => {
    expect(
      physicalBayKey({
        department_id: "dept-1",
        aisle: "41",
        bay: 11,
      })
    ).toBe("dept-1|41|11");
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).not.toMatch(/SELLING.*TOPSTOCK.*onDuty/);
  });

  it("Floor On now uses derived availability, not isOnDutyToday", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).toMatch(/composeCurrentAvailability/);
    expect(floor).toMatch(/isScheduledNow/);
    expect(floor).not.toMatch(/isOnDutyToday/);
    expect(floor).not.toMatch(/DEFAULT_SHIFT_HOURS/);
  });

  it("Roster shows derived availability separately from explicit call-out actions", () => {
    const card = readRepo("components/hub/SpecialistCard.tsx");
    const roster = readRepo("components/hub/tabs/RosterTab.tsx");
    expect(card).toMatch(/availability\.label/);
    expect(card).toMatch(/Mark called out/);
    expect(card).toMatch(/Clear call-out/);
    expect(card).not.toMatch(/role=\"switch\"/);
    expect(roster).toMatch(/composeCurrentAvailability/);
    expect(roster).toMatch(/markCallOut/);
  });

  it("Floor Pad still uses day-level isOnDutyToday (protected)", () => {
    const pad = readRepo("components/dashboard/TacticalVoiceFloorPad.tsx");
    expect(pad).toMatch(/isOnDutyToday/);
    expect(pad).not.toMatch(/composeCurrentAvailability/);
  });

  it("call-out redistribution source is unchanged", () => {
    const callOut = readRepo("lib/store-ops/call-out.ts");
    expect(callOut).toMatch(/mode === "pool"/);
    expect(callOut).toMatch(/mode === "carry"/);
    expect(callOut).toMatch(/knownHoursOnly: true/);
    expect(callOut).not.toMatch(/composeCurrentAvailability/);
  });

  it("no persisted is_on_shift and no availability migration", () => {
    const availability = readRepo("lib/store-ops/current-availability.ts");
    expect(availability).not.toMatch(/is_on_shift/);
    expect(availability).not.toMatch(/DEFAULT_SHIFT_HOURS|DEFAULT_START|DEFAULT_END/);
    const migrations = fs.readdirSync(path.join(root, "supabase/migrations"));
    expect(migrations.some((name) => /availability|is_on_shift|time.duty/i.test(name))).toBe(
      false
    );
  });

  it("clock tick recomputes locally; SHIFT_STATUS_EVENT still refetches evidence", () => {
    const tick = readRepo("lib/store-ops/use-store-clock.ts");
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    const roster = readRepo("components/hub/tabs/RosterTab.tsx");
    expect(tick).not.toMatch(/fetchShiftDays|upsertShiftDay|supabase/);
    expect(floor).toMatch(/useStoreClockTick/);
    expect(floor).toMatch(/now: clockNow/);
    expect(floor).toMatch(/SHIFT_STATUS_EVENT/);
    expect(roster).toMatch(/useStoreClockTick/);
    expect(roster).toMatch(/SHIFT_STATUS_EVENT/);
    expect(roster).toMatch(/composeShiftBoard/);
  });

  it("UI copy is schedule-derived, not punch/attendance", () => {
    const files = [
      "components/hub/tabs/FloorTab.tsx",
      "components/hub/tabs/RosterTab.tsx",
      "components/hub/SpecialistCard.tsx",
      "components/store-ops/OnDutyAssociateStrip.tsx",
    ];
    for (const rel of files) {
      const source = readRepo(rel);
      expect(source).not.toMatch(/clocked in|clocked out|punched in|physically present|tardy|no-show/i);
    }
    const strip = readRepo("components/store-ops/OnDutyAssociateStrip.tsx");
    expect(strip).toMatch(/On now/);
    expect(strip).not.toMatch(/On duty today/);
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).toMatch(/later today/);
    const seasonal = readRepo("lib/store-ops/operational-context.ts");
    const gemini = readRepo("lib/ai/gemini.ts");
    expect(seasonal).not.toMatch(/composeCurrentAvailability/);
    expect(gemini).not.toMatch(/composeCurrentAvailability/);
  });
});
