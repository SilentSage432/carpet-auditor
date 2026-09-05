import { describe, expect, it } from "vitest";
import {
  filterActiveWeeklyRotations,
  isActiveWeeklyRotation,
} from "@/lib/store-ops/rotation-history";
import {
  composeWeeklyRotationMetrics,
  WEEKLY_ROTATION_METRICS_METHOD,
} from "@/lib/store-ops/rotation-metrics";

describe("rotation history — active vs superseded", () => {
  it("Case A — active row has null/empty superseded_at", () => {
    expect(isActiveWeeklyRotation({ superseded_at: null })).toBe(true);
    expect(isActiveWeeklyRotation({ superseded_at: undefined })).toBe(true);
    expect(isActiveWeeklyRotation({ superseded_at: "" })).toBe(true);
    expect(
      isActiveWeeklyRotation({ superseded_at: "2026-09-03T18:00:00.000Z" })
    ).toBe(false);
  });

  it("Case B — restage fixture: superseded Monday stage + Wednesday active", () => {
    const rotationA = {
      id: "rot-a",
      location_id: "loc-41-07",
      assigned_week: "2026-W36",
      created_at: "2026-09-01T12:00:00.000Z",
      superseded_at: "2026-09-03T18:00:00.000Z",
      supersede_source: "FORCE_DRAW",
      is_completed: false,
      verification_status: "PENDING",
    };
    const rotationB = {
      id: "rot-b",
      location_id: "loc-41-07",
      assigned_week: "2026-W36",
      created_at: "2026-09-03T18:05:00.000Z",
      superseded_at: null,
      is_completed: false,
      verification_status: "PENDING",
    };

    expect(isActiveWeeklyRotation(rotationA)).toBe(false);
    expect(isActiveWeeklyRotation(rotationB)).toBe(true);
    expect(filterActiveWeeklyRotations([rotationA, rotationB])).toEqual([
      rotationB,
    ]);
    // Original stage identity retained on historical row
    expect(rotationA.created_at).toBe("2026-09-01T12:00:00.000Z");
    expect(rotationA.superseded_at).toBe("2026-09-03T18:00:00.000Z");
  });

  it("Case C — uniqueness contract (DB partial unique; app active filter)", () => {
    // Schema: UNIQUE (location_id, assigned_week) WHERE superseded_at IS NULL
    // Two active rows for the same location/week must be impossible after migration.
    const twoActive = [
      { id: "a", superseded_at: null as string | null },
      { id: "b", superseded_at: null as string | null },
    ];
    expect(filterActiveWeeklyRotations(twoActive)).toHaveLength(2);
    // App-layer cannot enforce uniqueness alone; migration
    // weekly_rotations_active_location_week_uidx rejects the second insert.
  });

  it("Case D — Layer-1 staged counts active only", () => {
    const metrics = composeWeeklyRotationMetrics({
      rotations: [
        {
          is_completed: false,
          verification_status: "PENDING",
          superseded_at: "2026-09-03T18:00:00.000Z",
        },
        {
          is_completed: false,
          verification_status: "PENDING",
          superseded_at: null,
        },
      ],
      weeklyTarget: 10,
    });
    expect(metrics.method).toBe(WEEKLY_ROTATION_METRICS_METHOD);
    expect(metrics.staged).toBe(1);
    expect(metrics.open).toBe(1);
  });

  it("Case E — superseded verified/reported do not inflate active metrics", () => {
    const metrics = composeWeeklyRotationMetrics({
      rotations: [
        {
          is_completed: true,
          verification_status: "VERIFIED_COMPLETE",
          completed_at: "2026-09-01T10:00:00.000Z",
          verified_at: "2026-09-01T11:00:00.000Z",
          superseded_at: "2026-09-03T18:00:00.000Z",
        },
        {
          is_completed: true,
          verification_status: "PENDING_VERIFICATION",
          completed_at: "2026-09-02T10:00:00.000Z",
          superseded_at: "2026-09-03T18:00:00.000Z",
        },
        {
          is_completed: false,
          verification_status: "PENDING",
          superseded_at: null,
        },
      ],
      weeklyTarget: 12,
    });
    expect(metrics.staged).toBe(1);
    expect(metrics.verifiedComplete).toBe(0);
    expect(metrics.reportedComplete).toBe(0);
    expect(metrics.pendingVerification).toBe(0);
    expect(metrics.open).toBe(1);
  });

  it("Case F — operational filter ignores superseded rows", () => {
    const weekRows = [
      { id: "a", superseded_at: "2026-09-03T00:00:00.000Z" },
      { id: "b", superseded_at: null },
      { id: "c", superseded_at: undefined },
    ];
    expect(filterActiveWeeklyRotations(weekRows).map((r) => r.id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("Case G — completed active rows remain countable (Force Draw preserves them)", () => {
    const metrics = composeWeeklyRotationMetrics({
      rotations: [
        {
          is_completed: true,
          verification_status: "VERIFIED_COMPLETE",
          completed_at: "2026-09-02T10:00:00.000Z",
          verified_at: "2026-09-02T12:00:00.000Z",
          superseded_at: null,
        },
        {
          is_completed: false,
          verification_status: "PENDING",
          superseded_at: "2026-09-03T18:00:00.000Z",
        },
      ],
      weeklyTarget: 12,
    });
    expect(metrics.staged).toBe(1);
    expect(metrics.verifiedComplete).toBe(1);
    expect(metrics.open).toBe(0);
  });

  it("Case H — migration default active: absent superseded_at counts as active", () => {
    const metrics = composeWeeklyRotationMetrics({
      rotations: [{ is_completed: false, verification_status: "PENDING" }],
      weeklyTarget: 10,
    });
    expect(metrics.staged).toBe(1);
  });
});
