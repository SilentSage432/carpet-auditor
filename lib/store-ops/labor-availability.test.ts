/**
 * LAB-001 department scheduled-labor evidence — pure composer tests.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEPARTMENT_SCHEDULED_LABOR_METHOD,
  DEPARTMENT_SCHEDULED_LABOR_VERSION,
  attachLaborAvailabilityGeneratedAt,
  composeDepartmentLaborAvailability,
  knownShiftHours,
  type DepartmentLaborAvailabilityInput,
  type LabPersistedShiftDayInput,
  type LabWorkforceMemberInput,
} from "./labor-availability";

const DATE = "2026-09-06";
const AS_OF = "2026-09-06T15:00:00.000Z";

function member(
  partial: Partial<LabWorkforceMemberInput> & { id: string }
): LabWorkforceMemberInput {
  return {
    role: "Associate",
    is_active: true,
    home_department: "flooring",
    assigned_department: "flooring",
    ...partial,
  };
}

function shift(
  partial: Partial<LabPersistedShiftDayInput> & { specialist_id: string }
): LabPersistedShiftDayInput {
  return {
    work_date: DATE,
    start_time: "07:00",
    end_time: "15:30",
    is_scheduled_today: true,
    is_call_out: false,
    status: "ON_DUTY",
    ...partial,
  };
}

function baseInput(
  overrides: Partial<DepartmentLaborAvailabilityInput> = {}
): DepartmentLaborAvailabilityInput {
  return {
    department: "flooring",
    workforce: [member({ id: "a1" })],
    persisted_shift_days: [shift({ specialist_id: "a1" })],
    operational_date: DATE,
    as_of: AS_OF,
    workforce_evidence_available: true,
    schedule_evidence_available: true,
    ...overrides,
  };
}

describe("knownShiftHours (fact-pure)", () => {
  it("returns known hours for valid start/end", () => {
    expect(knownShiftHours("07:00", "15:30")).toBe(8.5);
  });

  it("returns null when start missing", () => {
    expect(knownShiftHours(null, "15:30")).toBeNull();
    expect(knownShiftHours("", "15:30")).toBeNull();
  });

  it("returns null when end missing", () => {
    expect(knownShiftHours("07:00", null)).toBeNull();
  });

  it("returns null for malformed times", () => {
    expect(knownShiftHours("25:00", "15:30")).toBeNull();
    expect(knownShiftHours("07:00", "nope")).toBeNull();
  });

  it("handles overnight per canonical hoursBetween", () => {
    expect(knownShiftHours("22:00", "06:00")).toBe(8);
  });

  it("preserves tenth-hour precision", () => {
    expect(knownShiftHours("07:00", "15:18")).toBe(8.3);
  });

  it("never returns 8 for missing duration", () => {
    expect(knownShiftHours(null, null)).toBeNull();
    expect(knownShiftHours(undefined, undefined)).toBeNull();
  });
});

describe("composeDepartmentLaborAvailability — workforce", () => {
  it("includes active Associate in home department", () => {
    const r = composeDepartmentLaborAvailability(baseInput());
    expect(r.workforce_member_count).toBe(1);
    expect(r.persisted_scheduled_member_count).toBe(1);
  });

  it("includes roster-only style member (no app_access field required)", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        workforce: [member({ id: "roster-only" })],
        persisted_shift_days: [shift({ specialist_id: "roster-only" })],
      })
    );
    expect(r.workforce_member_count).toBe(1);
    expect(r.persisted_scheduled_member_count).toBe(1);
  });

  it("includes Supervisor in home department", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        workforce: [member({ id: "ds1", role: "Supervisor" })],
        persisted_shift_days: [shift({ specialist_id: "ds1" })],
      })
    );
    expect(r.workforce_member_count).toBe(1);
    expect(r.known_scheduled_hours).toBe(8.5);
  });

  it("excludes MasterAdmin", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        workforce: [
          member({ id: "m1", role: "MasterAdmin", home_department: "all" }),
          member({ id: "a1" }),
        ],
        persisted_shift_days: [
          shift({ specialist_id: "m1" }),
          shift({ specialist_id: "a1" }),
        ],
      })
    );
    expect(r.workforce_member_count).toBe(1);
    expect(r.persisted_scheduled_member_count).toBe(1);
  });

  it("excludes inactive members from aggregates", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        workforce: [member({ id: "x1", is_active: false })],
        persisted_shift_days: [shift({ specialist_id: "x1" })],
      })
    );
    expect(r.workforce_member_count).toBe(0);
    expect(r.persisted_scheduled_member_count).toBe(0);
    expect(r.known_scheduled_hours).toBe(0);
    expect(
      r.reasons.some((x) => x.code === "INACTIVE_SCHEDULED_MEMBER")
    ).toBe(true);
    expect(r.processing_status).toBe("PARTIAL");
  });

  it("does not attribute hours via accessible-only foreign department", () => {
    // Composer has no accessible_departments input — home Garden query gets 0
    // from a Flooring-home member even if caller mistakenly includes the row.
    const r = composeDepartmentLaborAvailability(
      baseInput({
        department: "lawn_garden",
        workforce: [
          member({
            id: "a1",
            home_department: "flooring",
            assigned_department: "flooring",
          }),
        ],
        persisted_shift_days: [shift({ specialist_id: "a1" })],
      })
    );
    expect(r.workforce_member_count).toBe(0);
    expect(r.known_scheduled_hours).toBe(0);
    expect(r.persisted_scheduled_member_count).toBe(0);
  });

  it("home_department takes precedence over assigned_department", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        department: "appliances",
        workforce: [
          member({
            id: "a1",
            home_department: "appliances",
            assigned_department: "flooring",
          }),
        ],
        persisted_shift_days: [shift({ specialist_id: "a1" })],
      })
    );
    expect(r.workforce_member_count).toBe(1);
    expect(r.known_scheduled_hours).toBe(8.5);
  });

  it("does not double-count home + assigned compatibility fields", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        workforce: [
          member({
            id: "a1",
            home_department: "flooring",
            assigned_department: "flooring",
          }),
        ],
        persisted_shift_days: [shift({ specialist_id: "a1" })],
      })
    );
    expect(r.workforce_member_count).toBe(1);
    expect(r.persisted_scheduled_member_count).toBe(1);
  });
});

describe("composeDepartmentLaborAvailability — persisted schedule truth", () => {
  it("counts explicit persisted scheduled shift", () => {
    const r = composeDepartmentLaborAvailability(baseInput());
    expect(r.persisted_scheduled_member_count).toBe(1);
    expect(r.expected_on_duty_count).toBe(1);
  });

  it("missing persisted row creates no declared schedule evidence", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        workforce: [member({ id: "a1" }), member({ id: "a2" })],
        persisted_shift_days: [shift({ specialist_id: "a1" })],
      })
    );
    expect(r.workforce_member_count).toBe(2);
    expect(r.persisted_scheduled_member_count).toBe(1);
    expect(r.known_scheduled_hours).toBe(8.5);
  });

  it("source does not import board composers", () => {
    const source = readFileSync(
      resolve(__dirname, "labor-availability.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/from\s+["'].*shift-status["']/);
    expect(source).not.toMatch(/\bcomposeShiftBoard\b/);
    expect(source).not.toMatch(/\bdefaultDay\b/);
  });

  it("explicit OFF row does not count as scheduled", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        persisted_shift_days: [
          shift({
            specialist_id: "a1",
            is_scheduled_today: false,
            is_call_out: false,
            status: "OFF",
            start_time: null,
            end_time: null,
          }),
        ],
      })
    );
    expect(r.persisted_scheduled_member_count).toBe(0);
    expect(r.known_scheduled_hours).toBe(0);
    expect(r.expected_on_duty_count).toBe(0);
  });

  it("exact duplicate rows collapse to one factual row", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        persisted_shift_days: [
          shift({ specialist_id: "a1" }),
          shift({ specialist_id: "a1" }),
        ],
      })
    );
    expect(r.persisted_scheduled_member_count).toBe(1);
    expect(r.known_scheduled_hours).toBe(8.5);
    expect(r.expected_on_duty_count).toBe(1);
    expect(r.reasons.some((x) => x.code === "CONFLICTING_SHIFT_DAY")).toBe(
      false
    );
  });

  it("conflicting duplicate key is not invented into a factual winner", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        persisted_shift_days: [
          shift({
            specialist_id: "a1",
            start_time: "07:00",
            end_time: "15:30",
            is_call_out: false,
            status: "ON_DUTY",
          }),
          shift({
            specialist_id: "a1",
            start_time: "07:00",
            end_time: "15:30",
            is_call_out: true,
            status: "ABSENT_CALLOUT",
          }),
        ],
      })
    );
    expect(r.persisted_scheduled_member_count).toBe(0);
    expect(r.known_scheduled_hours).toBe(0);
    expect(r.known_callout_member_count).toBe(0);
    expect(r.known_callout_hours).toBe(0);
    expect(r.expected_on_duty_count).toBe(0);
    expect(r.processing_status).toBe("PARTIAL");
    expect(r.reasons.some((x) => x.code === "CONFLICTING_SHIFT_DAY")).toBe(
      true
    );
  });

  it("conflicting times for same specialist/date are excluded", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        persisted_shift_days: [
          shift({
            specialist_id: "a1",
            start_time: "07:00",
            end_time: "15:30",
          }),
          shift({
            specialist_id: "a1",
            start_time: "10:00",
            end_time: "18:30",
          }),
        ],
      })
    );
    expect(r.known_scheduled_hours).toBe(0);
    expect(r.reasons.some((x) => x.code === "CONFLICTING_SHIFT_DAY")).toBe(
      true
    );
  });
});

describe("composeDepartmentLaborAvailability — known hours", () => {
  it("sums valid start/end into known_scheduled_hours", () => {
    expect(composeDepartmentLaborAvailability(baseInput()).known_scheduled_hours).toBe(
      8.5
    );
  });

  it("missing start → unknown duration, no hours", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        persisted_shift_days: [
          shift({ specialist_id: "a1", start_time: null, end_time: "15:30" }),
        ],
      })
    );
    expect(r.known_scheduled_hours).toBe(0);
    expect(r.unknown_duration_count).toBe(1);
    expect(r.persisted_scheduled_member_count).toBe(1);
    expect(r.reasons.some((x) => x.code === "MISSING_SHIFT_DURATION")).toBe(
      true
    );
  });

  it("missing end → unknown", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        persisted_shift_days: [
          shift({ specialist_id: "a1", start_time: "07:00", end_time: null }),
        ],
      })
    );
    expect(r.known_scheduled_hours).toBe(0);
    expect(r.unknown_duration_count).toBe(1);
  });

  it("malformed time → unknown", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        persisted_shift_days: [
          shift({
            specialist_id: "a1",
            start_time: "xx",
            end_time: "15:30",
          }),
        ],
      })
    );
    expect(r.known_scheduled_hours).toBe(0);
    expect(r.unknown_duration_count).toBe(1);
  });

  it("overnight shift uses canonical duration", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        persisted_shift_days: [
          shift({
            specialist_id: "a1",
            start_time: "22:00",
            end_time: "06:00",
          }),
        ],
      })
    );
    expect(r.known_scheduled_hours).toBe(8);
  });

  it("fractional duration preserved", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        persisted_shift_days: [
          shift({
            specialist_id: "a1",
            start_time: "10:00",
            end_time: "14:00",
          }),
        ],
      })
    );
    expect(r.known_scheduled_hours).toBe(4);
  });
});

describe("composeDepartmentLaborAvailability — fallback isolation", () => {
  it("missing duration never contributes 8 hours", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        persisted_shift_days: [
          shift({
            specialist_id: "a1",
            start_time: null,
            end_time: null,
          }),
        ],
      })
    );
    expect(r.known_scheduled_hours).not.toBe(8);
    expect(r.known_scheduled_hours).toBe(0);
  });

  it("LAB source does not invoke clampShiftHours / DEFAULT_SHIFT_HOURS", () => {
    const source = readFileSync(
      resolve(__dirname, "labor-availability.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/clampShiftHours/);
    expect(source).not.toMatch(/DEFAULT_SHIFT_HOURS/);
    expect(source).not.toMatch(/\ballocationWeightHours\b/);
  });

  it("existing planning helpers remain untouched (source still exists)", () => {
    const week = readFileSync(
      resolve(__dirname, "weekly-rotations.ts"),
      "utf8"
    );
    expect(week).toMatch(/export function clampShiftHours/);
    expect(week).toMatch(/DEFAULT_SHIFT_HOURS/);
  });
});

describe("composeDepartmentLaborAvailability — call-out", () => {
  it("call-out with valid times → known callout member + hours", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        persisted_shift_days: [
          shift({
            specialist_id: "a1",
            is_call_out: true,
            status: "ABSENT_CALLOUT",
          }),
        ],
      })
    );
    expect(r.persisted_scheduled_member_count).toBe(1);
    expect(r.known_callout_member_count).toBe(1);
    expect(r.known_callout_hours).toBe(8.5);
    // Gross declared schedule includes call-out duration (not net presence).
    expect(r.known_scheduled_hours).toBe(8.5);
    expect(r.expected_on_duty_count).toBe(0);
  });

  it("gross scheduled hours include call-out; callout hours are the absent subset", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        workforce: [member({ id: "a1" }), member({ id: "a2" })],
        persisted_shift_days: [
          shift({ specialist_id: "a1" }),
          shift({
            specialist_id: "a2",
            is_call_out: true,
            status: "ABSENT_CALLOUT",
          }),
        ],
      })
    );
    expect(r.known_scheduled_hours).toBe(17);
    expect(r.known_callout_hours).toBe(8.5);
    expect(r.expected_on_duty_count).toBe(1);
    expect(r).not.toHaveProperty("net_available_hours");
    expect(r).not.toHaveProperty("productive_hours");
    expect(r).not.toHaveProperty("usable_hours");
  });

  it("call-out missing duration → member counted, hours unknown", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        persisted_shift_days: [
          shift({
            specialist_id: "a1",
            is_call_out: true,
            status: "ABSENT_CALLOUT",
            start_time: null,
            end_time: null,
          }),
        ],
      })
    );
    expect(r.known_callout_member_count).toBe(1);
    expect(r.known_callout_hours).toBe(0);
    expect(r.callout_duration_unknown_count).toBe(1);
    expect(r.reasons.some((x) => x.code === "CALLOUT_DURATION_UNKNOWN")).toBe(
      true
    );
  });

  it("call-out is not expected on-duty", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        persisted_shift_days: [
          shift({
            specialist_id: "a1",
            is_call_out: true,
            status: "ABSENT_CALLOUT",
          }),
        ],
      })
    );
    expect(r.expected_on_duty_count).toBe(0);
  });
});

describe("composeDepartmentLaborAvailability — department attribution", () => {
  it("home Flooring + 8h → Flooring only", () => {
    const flooring = composeDepartmentLaborAvailability(
      baseInput({
        department: "flooring",
        workforce: [
          member({
            id: "a1",
            home_department: "flooring",
            assigned_department: "flooring",
          }),
        ],
      })
    );
    expect(flooring.known_scheduled_hours).toBe(8.5);
  });

  it("Garden query receives zero from Flooring-home member", () => {
    const garden = composeDepartmentLaborAvailability(
      baseInput({
        department: "lawn_garden",
        workforce: [
          member({
            id: "a1",
            home_department: "flooring",
            assigned_department: "flooring",
          }),
        ],
        persisted_shift_days: [shift({ specialist_id: "a1" })],
      })
    );
    expect(garden.workforce_member_count).toBe(0);
    expect(garden.known_scheduled_hours).toBe(0);
  });

  it("unresolved/all home is not guessed into scoped total", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        department: "flooring",
        workforce: [
          member({
            id: "x1",
            role: "Associate",
            home_department: "all",
            assigned_department: "all",
          }),
        ],
        persisted_shift_days: [shift({ specialist_id: "x1" })],
      })
    );
    expect(r.workforce_member_count).toBe(0);
    expect(r.known_scheduled_hours).toBe(0);
    expect(r.reasons.some((x) => x.code === "UNATTRIBUTED_HOME")).toBe(true);
  });
});

describe("composeDepartmentLaborAvailability — evidence semantics", () => {
  it("zero known hours with workforce present is not invented empty department", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        workforce: [member({ id: "a1" })],
        persisted_shift_days: [],
      })
    );
    expect(r.workforce_member_count).toBe(1);
    expect(r.known_scheduled_hours).toBe(0);
    expect(r.persisted_scheduled_member_count).toBe(0);
    expect(r.processing_status).toBe("OK");
  });

  it("unknown durations are explicit and mark PARTIAL", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        persisted_shift_days: [
          shift({ specialist_id: "a1", start_time: null, end_time: null }),
        ],
      })
    );
    expect(r.unknown_duration_count).toBe(1);
    expect(r.processing_status).toBe("PARTIAL");
  });

  it("never claims COMPLETE schedule completeness", () => {
    const r = composeDepartmentLaborAvailability(baseInput());
    expect(r).not.toHaveProperty("schedule_completeness");
    expect(JSON.stringify(r)).not.toMatch(/COMPLETE/);
    expect(["OK", "PARTIAL", "UNAVAILABLE"]).toContain(r.processing_status);
  });

  it("identical evidence with reordered inputs yields identical result", () => {
    const a = composeDepartmentLaborAvailability(
      baseInput({
        workforce: [member({ id: "b" }), member({ id: "a" })],
        persisted_shift_days: [
          shift({ specialist_id: "b" }),
          shift({ specialist_id: "a" }),
        ],
      })
    );
    const b = composeDepartmentLaborAvailability(
      baseInput({
        workforce: [member({ id: "a" }), member({ id: "b" })],
        persisted_shift_days: [
          shift({ specialist_id: "a" }),
          shift({ specialist_id: "b" }),
        ],
      })
    );
    expect(a).toEqual(b);
  });

  it("unavailable sources do not invent empty-labor truth", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        workforce_evidence_available: false,
        schedule_evidence_available: true,
        workforce: [],
        persisted_shift_days: [],
      })
    );
    expect(r.processing_status).toBe("UNAVAILABLE");
    expect(r.reasons.some((x) => x.code === "WORKFORCE_UNAVAILABLE")).toBe(
      true
    );
    expect(r.workforce_member_count).toBeNull();
    expect(r.persisted_scheduled_member_count).toBeNull();
    expect(r.known_scheduled_hours).toBeNull();
    expect(r.expected_on_duty_count).toBeNull();
  });

  it("schedule unavailable keeps workforce count but nulls schedule aggregates", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        workforce_evidence_available: true,
        schedule_evidence_available: false,
        workforce: [member({ id: "a1" }), member({ id: "a2" })],
        persisted_shift_days: [],
      })
    );
    expect(r.processing_status).toBe("UNAVAILABLE");
    expect(r.workforce_member_count).toBe(2);
    expect(r.persisted_scheduled_member_count).toBeNull();
    expect(r.known_scheduled_hours).toBeNull();
    expect(r.known_callout_hours).toBeNull();
    expect(r.expected_on_duty_count).toBeNull();
    expect(r.reasons.some((x) => x.code === "SCHEDULE_UNAVAILABLE")).toBe(
      true
    );
  });

  it("both sources unavailable → all dependent aggregates null", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        workforce_evidence_available: false,
        schedule_evidence_available: false,
      })
    );
    expect(r.processing_status).toBe("UNAVAILABLE");
    expect(r.workforce_member_count).toBeNull();
    expect(r.known_scheduled_hours).toBeNull();
    expect(r.persisted_scheduled_member_count).toBeNull();
  });

  it("both sources available may return literal zero without UNAVAILABLE", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        workforce: [member({ id: "a1" })],
        persisted_shift_days: [],
      })
    );
    expect(r.processing_status).toBe("OK");
    expect(r.workforce_member_count).toBe(1);
    expect(r.known_scheduled_hours).toBe(0);
    expect(r.persisted_scheduled_member_count).toBe(0);
  });
});

describe("composeDepartmentLaborAvailability — temporal / contract", () => {
  it("uses only supplied operational_date rows", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        operational_date: DATE,
        persisted_shift_days: [
          shift({ specialist_id: "a1", work_date: DATE }),
          shift({
            specialist_id: "a1",
            work_date: "2026-09-07",
            start_time: "07:00",
            end_time: "19:00",
          }),
        ],
      })
    );
    expect(r.known_scheduled_hours).toBe(8.5);
  });

  it("expected_on_duty uses only persisted day evidence for supplied operational_date", () => {
    const r = composeDepartmentLaborAvailability(
      baseInput({
        operational_date: DATE,
        workforce: [member({ id: "a1" }), member({ id: "a2" })],
        persisted_shift_days: [
          shift({ specialist_id: "a1", work_date: DATE }),
          shift({
            specialist_id: "a2",
            work_date: DATE,
            is_call_out: true,
            status: "ABSENT_CALLOUT",
          }),
          shift({
            specialist_id: "a1",
            work_date: "2026-09-07",
            start_time: "07:00",
            end_time: "19:00",
          }),
        ],
      })
    );
    expect(r.expected_on_duty_count).toBe(1);
    expect(r.known_callout_member_count).toBe(1);
  });

  it("source has no Date.now / new Date in pure composer path", () => {
    const source = readFileSync(
      resolve(__dirname, "labor-availability.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/Date\.now\(/);
    expect(source).not.toMatch(/new Date\(/);
  });

  it("does not silently merge retail/ISO week engines", () => {
    const source = readFileSync(
      resolve(__dirname, "labor-availability.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/isoWeekLabel/);
    expect(source).not.toMatch(/retailWeek/);
  });

  it("method identity is department-scheduled-labor-v1", () => {
    const r = composeDepartmentLaborAvailability(baseInput());
    expect(r.method).toBe(DEPARTMENT_SCHEDULED_LABOR_METHOD);
    expect(r.method_version).toBe(DEPARTMENT_SCHEDULED_LABOR_VERSION);
    expect(r.method).toBe("department-scheduled-labor-v1");
  });

  it("attachLaborAvailabilityGeneratedAt uses supplied stamp only", () => {
    const assessment = composeDepartmentLaborAvailability(baseInput());
    const signal = attachLaborAvailabilityGeneratedAt(
      assessment,
      "2026-09-06T16:00:00.000Z"
    );
    expect(signal.generated_at).toBe("2026-09-06T16:00:00.000Z");
    expect(signal.as_of).toBe(AS_OF);
  });

  it("forbids capacity / productivity / SI / target fields", () => {
    const r = composeDepartmentLaborAvailability(baseInput());
    expect(r).not.toHaveProperty("capacity");
    expect(r).not.toHaveProperty("bay_capacity");
    expect(r).not.toHaveProperty("productivity_rate");
    expect(r).not.toHaveProperty("utilization");
    expect(r).not.toHaveProperty("weekly_bay_target");
    expect(r).not.toHaveProperty("pressure");
    const source = readFileSync(
      resolve(__dirname, "labor-availability.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/from\s+["'].*location-attention/);
    expect(source).not.toMatch(/composeLocationAttentionPressure/);
    expect(source).not.toMatch(/\bweekly_bay_target\b/);
  });
});
