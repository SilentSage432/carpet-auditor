/**
 * DEPTSYNC-OPS-OVERVIEW-002 — call-out and sent-back attention.
 * Composition only. Does not write assignments, coverage, or publication.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requireStoreOpsActor, StoreOpsAuthError } from "./auth";
import { WEEKLY_ROTATION_AUTO_PUBLISH } from "./authoritative-week-cycle";
import {
  composeOverviewAttention,
  type OverviewCallOutRow,
} from "./overview-command";
import { composeThisWeekOwnership } from "./this-week-ownership";
import { supervisorManageHref } from "./supervisor-management-nav";
import { isoWeekCalendarRange } from "./week";
import type { WeeklyRotationWithLocation } from "./types";

const root = process.cwd();

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function rotation(
  id: string,
  aisle: string,
  bay: number,
  opts?: Partial<WeeklyRotationWithLocation>
): WeeklyRotationWithLocation {
  const location = {
    id: `loc-${id}`,
    store_id: "store-1",
    department_id: opts?.department_id ?? "dept-f",
    aisle,
    bay,
    type: "SELLING" as const,
    status: "PENDING",
    is_active: true,
    location_type: "STANDARD" as const,
  };
  return {
    id,
    store_id: "store-1",
    department_id: "dept-f",
    location_id: location.id,
    assigned_week: "2026-W43",
    is_completed: false,
    verification_status: "PENDING",
    review_note: null,
    ...opts,
    store_locations: (opts?.store_locations ??
      location) as WeeklyRotationWithLocation["store_locations"],
  } as WeeklyRotationWithLocation;
}

function assign(id: string, name: string) {
  return {
    specialist_id: id,
    specialist_name: name,
    assigned_at: "2026-10-19T12:00:00Z",
  };
}

const weekDates = isoWeekCalendarRange("2026-W43").dates;

function callOut(
  specialistId: string,
  workDate: string,
  storeNumber = "2587"
): OverviewCallOutRow {
  return {
    specialistId,
    workDate,
    isCallOut: true,
    storeNumber,
  };
}

describe("OPS-OVERVIEW-002 attention", () => {
  it("surfaces a called-out associate who still owns this week's bays", () => {
    const plan = composeThisWeekOwnership({
      rotations: [rotation("r1", "5", 1)],
      assignments: { r1: assign("nate", "Nate") },
    });
    const attention = composeOverviewAttention({
      plan,
      inbox: null,
      callOuts: [callOut("nate", weekDates[0]!)],
      operationalWeekDates: weekDates,
      storeNumber: "2587",
      departmentIds: ["dept-f"],
    });
    const item = attention.find((row) => row.kind === "week_call_out");
    expect(item?.label).toBe(
      "Nate has a call-out this week and still owns 1 bay"
    );
    expect(item?.label).not.toMatch(/absent today|is called out/i);
    expect(item?.detail).toMatch(/Ownership stays/);
    expect(item?.detail).toContain("A5-B01");
    expect(item?.ownerLabel).toBe("Nate");
    expect(item?.href).toBe("/dashboard");
    expect(item?.mapHref).toContain("aisle=5");
  });

  it("does not surface a call-out when that associate owns no bays", () => {
    const plan = composeThisWeekOwnership({
      rotations: [rotation("r1", "5", 1)],
      assignments: { r1: assign("tyson", "Tyson") },
    });
    const attention = composeOverviewAttention({
      plan,
      inbox: null,
      callOuts: [callOut("nate", weekDates[1]!)],
      operationalWeekDates: weekDates,
      storeNumber: "2587",
    });
    expect(attention.some((row) => row.kind === "week_call_out")).toBe(false);
  });

  it("ignores a call-out dated outside the operational week", () => {
    const plan = composeThisWeekOwnership({
      rotations: [rotation("r1", "5", 1)],
      assignments: { r1: assign("nate", "Nate") },
    });
    const attention = composeOverviewAttention({
      plan,
      inbox: null,
      callOuts: [callOut("nate", "2026-01-06")],
      operationalWeekDates: weekDates,
      storeNumber: "2587",
    });
    expect(attention.some((row) => row.kind === "week_call_out")).toBe(false);
  });

  it("counts every still-owed bay and skips verified ones", () => {
    const plan = composeThisWeekOwnership({
      rotations: [
        rotation("r1", "7", 2),
        rotation("r2", "7", 4),
        rotation("r3", "7", 9, {
          verification_status: "VERIFIED_COMPLETE",
          is_completed: true,
        }),
      ],
      assignments: {
        r1: assign("tracy", "Tracy"),
        r2: assign("tracy", "Tracy"),
        r3: assign("tracy", "Tracy"),
      },
    });
    const attention = composeOverviewAttention({
      plan,
      inbox: null,
      callOuts: [
        callOut("tracy", weekDates[0]!),
        callOut("tracy", weekDates[2]!),
      ],
      operationalWeekDates: weekDates,
      storeNumber: "2587",
    });
    const item = attention.find((row) => row.kind === "week_call_out");
    expect(item?.label).toBe(
      "Tracy has a call-out this week and still owns 2 bays"
    );
    expect(item?.detail).toContain("A7-B02");
    expect(item?.detail).toContain("A7-B04");
    expect(item?.detail).not.toContain("A7-B09");
    expect(attention.filter((row) => row.kind === "week_call_out")).toHaveLength(
      1
    );
  });

  it("drops call-outs from another store or another department", () => {
    const plan = composeThisWeekOwnership({
      rotations: [
        rotation("home", "41", 1, { department_id: "dept-other" }),
        rotation("floor", "5", 3),
      ],
      assignments: {
        home: assign("nick", "Nick"),
        floor: assign("nick", "Nick"),
      },
    });
    const foreignStore = composeOverviewAttention({
      plan,
      inbox: null,
      callOuts: [callOut("nick", weekDates[0]!, "9999")],
      operationalWeekDates: weekDates,
      storeNumber: "2587",
      departmentIds: ["dept-f"],
    });
    expect(foreignStore.some((row) => row.kind === "week_call_out")).toBe(
      false
    );

    const scoped = composeOverviewAttention({
      plan,
      inbox: null,
      callOuts: [callOut("nick", weekDates[0]!)],
      operationalWeekDates: weekDates,
      storeNumber: "2587",
      departmentIds: ["dept-f"],
    });
    const item = scoped.find((row) => row.kind === "week_call_out");
    expect(item?.label).toBe(
      "Nick has a call-out this week and still owns 1 bay"
    );
    expect(item?.detail).toContain("A5-B03");
    expect(item?.detail).not.toContain("A41-B01");
  });

  it("does not invent call-outs when the week range or rows are missing", () => {
    const plan = composeThisWeekOwnership({
      rotations: [rotation("r1", "5", 1)],
      assignments: { r1: assign("nate", "Nate") },
    });
    expect(
      composeOverviewAttention({
        plan,
        inbox: null,
        callOuts: [callOut("nate", weekDates[0]!)],
        operationalWeekDates: null,
        storeNumber: "2587",
      }).some((row) => row.kind === "week_call_out")
    ).toBe(false);
    expect(
      composeOverviewAttention({
        plan,
        inbox: null,
        callOuts: null,
        operationalWeekDates: weekDates,
        storeNumber: "2587",
      }).some((row) => row.kind === "week_call_out")
    ).toBe(false);
    expect(
      composeOverviewAttention({
        plan: null,
        inbox: null,
        callOuts: [callOut("nate", weekDates[0]!)],
        operationalWeekDates: weekDates,
        storeNumber: "2587",
      })
    ).toEqual([]);
  });

  it("surfaces assigned bays sent back for correction", () => {
    const plan = composeThisWeekOwnership({
      rotations: [
        rotation("r1", "43", 2, { review_note: "Reset the endcap" }),
        rotation("r2", "43", 8, { review_note: "Labels are wrong" }),
      ],
      assignments: {
        r1: assign("nick", "Nick"),
        r2: assign("tracy", "Tracy"),
      },
    });
    const attention = composeOverviewAttention({
      plan,
      inbox: null,
      departmentIds: ["dept-f"],
    });
    const item = attention.find((row) => row.kind === "week_sent_back");
    expect(item?.label).toBe("2 bays were sent back for correction");
    expect(item?.detail).toContain("A43-B02");
    expect(item?.detail).toContain("A43-B08");
    expect(item?.href).toBe("/dashboard");
    expect(item?.mapHref).toBeNull();
    expect(attention.some((row) => row.kind === "week_verify")).toBe(false);
  });

  it("drops sent-back attention once the bay is awaiting verification or verified", () => {
    const awaiting = composeThisWeekOwnership({
      rotations: [
        rotation("r1", "5", 1, {
          verification_status: "PENDING_VERIFICATION",
          is_completed: true,
          review_note: null,
        }),
      ],
      assignments: { r1: assign("nate", "Nate") },
    });
    const awaitingAttention = composeOverviewAttention({
      plan: awaiting,
      inbox: null,
    });
    expect(awaitingAttention.some((row) => row.kind === "week_sent_back")).toBe(
      false
    );
    expect(awaitingAttention.some((row) => row.kind === "week_verify")).toBe(
      true
    );

    const verified = composeThisWeekOwnership({
      rotations: [
        rotation("r1", "5", 1, {
          verification_status: "VERIFIED_COMPLETE",
          is_completed: true,
          review_note: "old coaching note",
        }),
      ],
      assignments: { r1: assign("nate", "Nate") },
    });
    const verifiedAttention = composeOverviewAttention({
      plan: verified,
      inbox: null,
    });
    expect(verifiedAttention.some((row) => row.kind === "week_sent_back")).toBe(
      false
    );
    expect(verifiedAttention.some((row) => row.kind === "week_verify")).toBe(
      false
    );
  });

  it("does not treat an unassigned review note as sent-back work", () => {
    const plan = composeThisWeekOwnership({
      rotations: [rotation("r1", "5", 1, { review_note: "Reset the endcap" })],
      assignments: {},
    });
    const attention = composeOverviewAttention({ plan, inbox: null });
    expect(attention.some((row) => row.kind === "week_sent_back")).toBe(false);
    expect(attention.some((row) => row.kind === "week_unowned")).toBe(true);
  });

  it("keeps the original attention categories", () => {
    const plan = composeThisWeekOwnership({
      rotations: [
        rotation("owned", "5", 1, {
          verification_status: "PENDING_VERIFICATION",
          is_completed: true,
        }),
        rotation("open", "5", 2),
        rotation("barrier", "5", 3),
      ],
      assignments: {
        owned: assign("nate", "Nate"),
        barrier: assign("nick", "Nick"),
      },
      barrierRotationIds: ["barrier"],
    });
    const attention = composeOverviewAttention({
      plan,
      inbox: null,
      callOuts: [],
      operationalWeekDates: weekDates,
      storeNumber: "2587",
    });
    expect(attention.map((row) => row.kind)).toEqual([
      "week_unowned",
      "week_verify",
      "week_barrier",
    ]);
  });

  it("links Automatic Rotation without recomputing publication", () => {
    expect(supervisorManageHref("rotation")).toBe("/settings?manage=rotation");
    const overview = readRepo("components/hub/tabs/OverviewTab.tsx");
    expect(overview).toContain('supervisorManageHref("rotation")');
    expect(overview).toContain("overview-automatic-rotation");
    expect(overview).not.toMatch(/WEEKLY_ROTATION_AUTO_PUBLISH/);
    expect(overview).not.toMatch(/redistributeCallOutBays|sendBackPendingBay/);
    expect(overview).not.toMatch(/standing capacity|establishStanding/i);
  });
});

describe("OPS-OVERVIEW-002 boundaries", () => {
  it("rejects a missing actor on the rotations read the Overview uses", () => {
    expect(() => requireStoreOpsActor(null)).toThrow(StoreOpsAuthError);
    try {
      requireStoreOpsActor(null);
    } catch (err) {
      expect(err).toBeInstanceOf(StoreOpsAuthError);
      expect((err as StoreOpsAuthError).status).toBe(401);
    }
    const route = readRepo("app/api/weekly-rotations/route.ts");
    expect(route).toContain("requireStoreOpsActor");
    expect(route).toContain("resolveScopedDepartmentId");
    expect(route).toContain("departmentIds");
    const shifts = readRepo("lib/store-ops/shift-status.ts");
    expect(shifts).toMatch(/storeKeys\(store\)/);
    expect(shifts).toContain("is_call_out");
  });

  it("does not mutate operational records from the composer or Overview", () => {
    const composer = readRepo("lib/store-ops/overview-command.ts");
    const overview = readRepo("components/hub/tabs/OverviewTab.tsx");
    expect(composer).not.toMatch(/\.update\(|\.insert\(|\.delete\(|\.upsert\(/);
    expect(overview).not.toMatch(
      /redistributeCallOutBays|sendBackPendingBay|verifyPending|completeRotation|applySundayAssignmentPlan/
    );
    expect(overview).toContain("fetchShiftDaysRange");
    expect(overview).toContain("isoWeekCalendarRange");
    expect(overview).toContain("overview-callouts-unavailable");
    expect(WEEKLY_ROTATION_AUTO_PUBLISH).toBe(true);
    const cron = readRepo("vercel.json");
    expect(cron).toContain('"schedule": "0 12 * * 0"');
  });
});
