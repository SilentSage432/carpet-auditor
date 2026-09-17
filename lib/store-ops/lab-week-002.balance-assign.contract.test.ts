/**
 * LAB-WEEK-002 — Balance Assign contract: schedule labor, not localStorage Sunday hours.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  composeWeekLaborAvailability,
  weekLaborToPlannerMembers,
} from "./labor-availability";
import { planProportionalBayAssignments } from "./weekly-rotations";
import { isoWeekCalendarRange } from "./week";

const WEEK = "2026-W12";
const AS_OF = "2026-03-16T12:00:00.000Z";

describe("Balance Assign authoritative labor boundary", () => {
  it("Sunday modal wires Balance Assign to persisted schedule composition", () => {
    const source = fs.readFileSync(
      path.join(
        __dirname,
        "../../components/admin/SundayAuditAssignmentModal.tsx"
      ),
      "utf8"
    );
    expect(source).toMatch(/composeWeekLaborAvailability/);
    expect(source).toMatch(/fetchShiftDaysRange/);
    expect(source).toMatch(/isoWeekCalendarRange/);
    expect(source).toMatch(/knownHoursOnly:\s*true/);
    expect(source).toMatch(/weekLaborToPlannerMembers/);
    // Must not plan from shiftRoster (localStorage) for Balance Assign.
    expect(source).toMatch(/buildScheduleBalancePlan/);
    expect(source).not.toMatch(
      /planProportionalBayAssignments\(\s*bays\.map[\s\S]*shiftRoster\s*\)/
    );
  });

  it("localStorage Sunday hours are not the automatic allocation input", () => {
    const range = isoWeekCalendarRange(WEEK);
    // Board says everyone 8h — schedule says unequal / later-week worker.
    const localStorageHours = { a: 8, b: 8, c: 8, d: 8 };
    const schedule = composeWeekLaborAvailability({
      department: "flooring",
      week_label: WEEK,
      dates: range.dates,
      workforce: ["a", "b", "c", "d"].map((id) => ({
        id,
        role: "Associate",
        is_active: true,
        home_department: "flooring",
        name: id,
      })),
      persisted_shift_days: [
        // a: full Mon–Fri
        ...range.dates.slice(0, 5).map((d) => ({
          specialist_id: "a",
          work_date: d,
          start_time: "07:00",
          end_time: "15:00",
          is_scheduled_today: true,
          is_call_out: false,
          status: "ON_DUTY",
        })),
        // d: Wed–Sat only (later-week)
        ...range.dates.slice(2, 6).map((d) => ({
          specialist_id: "d",
          work_date: d,
          start_time: "07:00",
          end_time: "15:00",
          is_scheduled_today: true,
          is_call_out: false,
          status: "ON_DUTY",
        })),
      ],
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: AS_OF,
    });

    const bays = Array.from({ length: 12 }, (_, i) => ({
      rotationId: `r${i}`,
      aisle: "10",
      bay: i + 1,
      riskScore: 0,
    }));

    const fromSchedule = planProportionalBayAssignments(
      bays,
      weekLaborToPlannerMembers(schedule.allocatable),
      { knownHoursOnly: true }
    );
    const fromBoard = planProportionalBayAssignments(
      bays,
      Object.entries(localStorageHours).map(([id, hours]) => ({
        specialist_id: id,
        specialist_name: id,
        active: true,
        hours,
      })),
      { knownHoursOnly: true }
    );

    // Schedule: only a (40h) and d (32h) allocatable — b,c missing evidence → excluded.
    expect(fromSchedule.loads.map((l) => l.specialist_id).sort()).toEqual([
      "a",
      "d",
    ]);
    // Board would invent even 3/3/3/3 across all four.
    expect(fromBoard.loads.map((l) => l.quota)).toEqual([3, 3, 3, 3]);
    expect(fromSchedule.loads.map((l) => l.quota)).not.toEqual([3, 3, 3, 3]);
    // Later-week worker d still receives fair weekly share from total week hours.
    const dQuota = fromSchedule.loads.find((l) => l.specialist_id === "d")!.quota;
    expect(dQuota).toBeGreaterThan(0);
    expect(dQuota).toBeLessThanOrEqual(
      fromSchedule.loads.find((l) => l.specialist_id === "a")!.quota
    );
  });

  it("sunday_bay_assignments remains the persistence writer path", () => {
    const modal = fs.readFileSync(
      path.join(
        __dirname,
        "../../components/admin/SundayAuditAssignmentModal.tsx"
      ),
      "utf8"
    );
    expect(modal).toMatch(/applySundayAssignmentPlan/);
    const audit = fs.readFileSync(
      path.join(__dirname, "sunday-audit.ts"),
      "utf8"
    );
    expect(audit).toMatch(/sunday_bay_assignments/);
  });

  it("people × 3 is a declared dispatch quota (ENGINE-PROD-002), not capacity inference", () => {
    // CAP-001 rejected inferred capacity. ENGINE-PROD-002 authorizes eligible × 3
    // as the normal automatic weekly dispatch quota in sunday-dispatch / week helpers.
    const callOut = fs.readFileSync(path.join(__dirname, "call-out.ts"), "utf8");
    expect(callOut).not.toMatch(/resolveAutomaticWeeklyBayTarget|BASE_WEEKLY_BAY_QUOTA/);
    const labor = fs.readFileSync(
      path.join(__dirname, "labor-availability.ts"),
      "utf8"
    );
    // Labor composition still does not invent staging volume.
    expect(labor).not.toMatch(/resolveAutomaticWeeklyBayTarget/);
  });
});
