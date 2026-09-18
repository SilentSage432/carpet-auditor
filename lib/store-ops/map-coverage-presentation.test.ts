/**
 * UX-REDUCE-003 — Map physical-bay coverage presentation contracts.
 */

import { describe, expect, it } from "vitest";
import {
  composeMapCoverageSummary,
  composePhysicalBayTone,
  countPhysicalBays,
  formatAisleBayCount,
  formatAisleCoverageProgress,
  formatMapCoverageSummaryLine,
  formatPhysicalBayCount,
  mapCoverageStateFromTone,
  mapCoverageToneLabel,
} from "./map-coverage-presentation";
import { classifyMapReadiness } from "./map-readiness";
import type { StoreLocation } from "./types";

function loc(
  partial: Partial<StoreLocation> &
    Pick<StoreLocation, "id" | "department_id" | "aisle" | "bay" | "type">
): StoreLocation {
  return {
    store_id: "s1",
    store_number: "1755",
    status: "PENDING",
    is_active: true,
    cycle_number: 1,
    last_completed_at: null,
    last_serviced_at: null,
    velocity_tier: "standard",
    priority_override: false,
    custom_decay_days: null,
    manual_priority_count: 0,
    workflow_type: "STANDARD_MERCH",
    location_type: "STANDARD",
    department_code: "FHD",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("UX-REDUCE-003 map coverage presentation", () => {
  it("counts 192 SELLING/TOPSTOCK rows as 96 physical bays", () => {
    const locations: StoreLocation[] = [];
    for (let bay = 1; bay <= 96; bay += 1) {
      const aisle = String(40 + Math.floor((bay - 1) / 16));
      const bayNum = ((bay - 1) % 16) + 1;
      locations.push(
        loc({
          id: `sell-${bay}`,
          department_id: "dept-fhd",
          aisle,
          bay: bayNum,
          type: "SELLING",
        }),
        loc({
          id: `top-${bay}`,
          department_id: "dept-fhd",
          aisle,
          bay: bayNum,
          type: "TOPSTOCK",
        })
      );
    }
    expect(locations).toHaveLength(192);
    expect(countPhysicalBays(locations)).toBe(96);
    expect(formatPhysicalBayCount(96)).toBe("96 physical bays");
    expect(formatPhysicalBayCount(96)).not.toMatch(/tag/i);
  });

  it("counts a single-surface bay as one physical bay", () => {
    const locations = [
      loc({
        id: "only-sell",
        department_id: "d1",
        aisle: "41",
        bay: 3,
        type: "SELLING",
      }),
    ];
    expect(countPhysicalBays(locations)).toBe(1);
    expect(formatAisleBayCount(1)).toBe("1 bay");
  });

  it("composes covered / this week / remaining / attention from tones", () => {
    const summary = composeMapCoverageSummary([
      "verified",
      "verified",
      "scheduled",
      "idle",
      "idle",
      "attention",
    ]);
    expect(summary).toEqual({
      physicalBayCount: 6,
      covered: 2,
      thisWeek: 1,
      needsAttention: 1,
      remaining: 2,
    });
    expect(formatMapCoverageSummaryLine(summary)).toContain("6 physical bays");
    expect(formatMapCoverageSummaryLine(summary)).toContain("2 remaining");
    expect(formatMapCoverageSummaryLine(summary)).not.toMatch(/tag/i);
  });

  it("labels ordinary owed coverage as Remaining, not failure", () => {
    expect(mapCoverageToneLabel("idle")).toBe("Remaining");
    expect(mapCoverageStateFromTone("idle")).toBe("remaining");
    expect(mapCoverageToneLabel("verified")).toBe("Covered");
    expect(mapCoverageToneLabel("scheduled")).toBe("This week");
    expect(mapCoverageToneLabel("attention")).toBe("Needs attention");
  });

  it("keeps classifyMapReadiness semantics for covered / this week / attention / idle", () => {
    const week = "2026-W38";
    expect(
      classifyMapReadiness({
        lastCompletedAt: "2026-09-15T12:00:00Z",
        weekLabel: week,
        currentWeekCompleted: true,
      })
    ).toBe("verified");
    expect(
      classifyMapReadiness({
        inCurrentWeekRotation: true,
        lastCompletedAt: "2026-09-10T12:00:00Z",
        weekLabel: week,
        now: new Date("2026-09-12T12:00:00Z"),
      })
    ).toBe("scheduled");
    expect(
      classifyMapReadiness({
        hasBarrier: true,
        lastCompletedAt: "2026-09-10T12:00:00Z",
        weekLabel: week,
        now: new Date("2026-09-12T12:00:00Z"),
      })
    ).toBe("attention");
    expect(
      classifyMapReadiness({
        lastCompletedAt: "2026-09-10T12:00:00Z",
        weekLabel: week,
        now: new Date("2026-09-12T12:00:00Z"),
      })
    ).toBe("idle");
  });

  it("physical bay tone prefers attention over this week over covered", () => {
    expect(composePhysicalBayTone(["verified", "scheduled"])).toBe("scheduled");
    expect(composePhysicalBayTone(["verified", "attention"])).toBe("attention");
    expect(composePhysicalBayTone(["idle", "verified"])).toBe("verified");
    expect(composePhysicalBayTone([])).toBe("idle");
  });

  it("aisle progress omits ordinary remaining from the loud line", () => {
    expect(
      formatAisleCoverageProgress({
        covered: 4,
        needsAttention: 0,
        physicalBayCount: 16,
      })
    ).toBe("4 covered");
    expect(
      formatAisleCoverageProgress({
        covered: 4,
        needsAttention: 2,
        physicalBayCount: 16,
      })
    ).toBe("4 covered · 2 need attention");
  });

  it("does not persist — helpers are pure", () => {
    const before = composeMapCoverageSummary(["idle"]);
    const after = composeMapCoverageSummary(["idle"]);
    expect(after).toEqual(before);
    expect(countPhysicalBays([])).toBe(0);
  });
});
