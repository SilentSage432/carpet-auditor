/**
 * LAB-WEEK-002 — proportional planner known-hours + on-duty surfacing truth.
 */

import { describe, expect, it } from "vitest";
import {
  composeOnDutyBayWorkload,
  planProportionalBayAssignments,
  proportionalQuotas,
  resolvePlannerHours,
  type RotationBayRef,
  type ShiftRosterMember,
} from "./weekly-rotations";

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

describe("resolvePlannerHours / knownHoursOnly", () => {
  it("legacy path still defaults invalid hours to 8", () => {
    expect(resolvePlannerHours(null)).toBe(8);
    expect(resolvePlannerHours(0)).toBe(8);
  });

  it("knownHoursOnly never invents 8 for zero/invalid and preserves weekly totals", () => {
    expect(resolvePlannerHours(null, true)).toBe(0);
    expect(resolvePlannerHours(0, true)).toBe(0);
    expect(resolvePlannerHours(4, true)).toBe(4);
    expect(resolvePlannerHours(40, true)).toBe(40);
  });
});

describe("planProportionalBayAssignments knownHoursOnly", () => {
  it("equal hours → even split (12 bays / 4 people ≈ 3 each)", () => {
    const bays = Array.from({ length: 12 }, (_, i) => bay(`r${i}`, "10", i + 1));
    const plan = planProportionalBayAssignments(
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

  it("4h vs 40h proportional ownership", () => {
    const bays = Array.from({ length: 11 }, (_, i) => bay(`r${i}`));
    const plan = planProportionalBayAssignments(
      bays,
      [member("short", 4), member("long", 40)],
      { knownHoursOnly: true }
    );
    const byId = Object.fromEntries(
      plan.loads.map((l) => [l.specialist_id, l.quota])
    );
    // 4/44 * 11 ≈ 1; 40/44 * 11 ≈ 10
    expect(byId.short).toBe(1);
    expect(byId.long).toBe(10);
  });

  it("zero hours excluded under knownHoursOnly", () => {
    const plan = planProportionalBayAssignments(
      [bay("r1"), bay("r2")],
      [member("zero", 0), member("ok", 8)],
      { knownHoursOnly: true }
    );
    expect(plan.loads.map((l) => l.specialist_id)).toEqual(["ok"]);
    expect(plan.items).toHaveLength(2);
  });

  it("unknown/excluded member (inactive or zero) does not receive bays", () => {
    const plan = planProportionalBayAssignments(
      [bay("r1"), bay("r2"), bay("r3")],
      [member("ghost", 8, false), member("ok", 8)],
      { knownHoursOnly: true }
    );
    expect(plan.items.every((i) => i.specialist_id === "ok")).toBe(true);
  });

  it("deterministic largest-remainder allocation", () => {
    const hours = [40, 32, 16, 4];
    const q1 = proportionalQuotas(hours, 12);
    const q2 = proportionalQuotas(hours, 12);
    expect(q1).toEqual(q2);
    expect(q1.reduce((a, b) => a + b, 0)).toBe(12);
    // Relative share: 40:32:16:4 = 10:8:4:1 → of 12 ≈ 5.22, 4.17, 2.09, 0.52 → 5,4,2,1
    expect(q1).toEqual([5, 4, 2, 1]);
  });

  it("fewer bays than people — some get zero quota", () => {
    const plan = planProportionalBayAssignments(
      [bay("r1"), bay("r2")],
      [member("a", 40), member("b", 40), member("c", 40), member("d", 4)],
      { knownHoursOnly: true }
    );
    expect(plan.items).toHaveLength(2);
    expect(plan.loads.reduce((s, l) => s + l.quota, 0)).toBe(2);
  });

  it("more bays than ~3/person rhythm still assigns all without hard quota", () => {
    const bays = Array.from({ length: 20 }, (_, i) => bay(`r${i}`));
    const plan = planProportionalBayAssignments(
      bays,
      [member("a", 40), member("b", 40)],
      { knownHoursOnly: true }
    );
    expect(plan.items).toHaveLength(20);
    expect(plan.loads.every((l) => l.quota === 10)).toBe(true);
  });

  it("all allocatable bays assigned when valid labor exists", () => {
    const bays = Array.from({ length: 7 }, (_, i) => bay(`r${i}`));
    const plan = planProportionalBayAssignments(
      bays,
      [member("a", 16), member("b", 8)],
      { knownHoursOnly: true }
    );
    expect(plan.items.map((i) => i.rotationId).sort()).toEqual(
      bays.map((b) => b.rotationId).sort()
    );
  });
});

describe("composeOnDutyBayWorkload — ownership vs display", () => {
  it("persisted ownership wins and stays when owner is off today", () => {
    const result = composeOnDutyBayWorkload({
      bays: [bay("r1"), bay("r2"), bay("r3")],
      assignments: {
        r1: { specialist_id: "off-owner" },
        r2: { specialist_id: "on-owner" },
      },
      onDuty: [
        {
          specialist_id: "on-owner",
          specialist_name: "On",
          hours: 8,
        },
        {
          specialist_id: "peer",
          specialist_name: "Peer",
          hours: 8,
        },
      ],
    });
    expect(result.assigneeByRotationId.r1).toBe("off-owner");
    expect(result.assigneeByRotationId.r2).toBe("on-owner");
    // Off-today owner keeps ownership — not reassigned to peer.
    expect(result.groups.find((g) => g.specialist_id === "peer")?.rotationIds).toEqual(
      []
    );
    expect(
      result.groups.find((g) => g.specialist_id === "on-owner")?.rotationIds
    ).toEqual(["r2"]);
  });

  it("unassigned bays stay unassigned — no display fill masquerading as ownership", () => {
    const result = composeOnDutyBayWorkload({
      bays: [bay("r1"), bay("r2")],
      assignments: {},
      onDuty: [
        { specialist_id: "a", specialist_name: "A", hours: 8 },
        { specialist_id: "b", specialist_name: "B", hours: 8 },
      ],
    });
    expect(result.unassignedIds.sort()).toEqual(["r1", "r2"]);
    expect(result.assigneeByRotationId).toEqual({});
    expect(result.groups.every((g) => g.plannedRotationIds.length === 0)).toBe(
      true
    );
    expect(result.groups.every((g) => g.rotationIds.length === 0)).toBe(true);
  });
});
