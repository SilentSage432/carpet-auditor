import { describe, expect, it } from "vitest";
import { composeFloorReadinessLine } from "@/lib/store-ops/floor-readiness";

describe("composeFloorReadinessLine", () => {
  it("reports truthful stale-of-total with weekly target", () => {
    expect(
      composeFloorReadinessLine({
        totalBays: 124,
        staleCount: 87,
        weeklyTarget: 15,
      })
    ).toBe("Readiness: 87 of 124 currently stale · target 15/week");
  });

  it("appends this-week open/complete when work exists", () => {
    expect(
      composeFloorReadinessLine({
        totalBays: 124,
        staleCount: 124,
        weeklyTarget: 12,
        weekOpen: 0,
        weekComplete: 0,
      })
    ).toBe("Readiness: 124 of 124 currently stale · target 12/week");

    expect(
      composeFloorReadinessLine({
        totalBays: 124,
        staleCount: 100,
        weeklyTarget: 12,
        weekOpen: 10,
        weekComplete: 2,
      })
    ).toBe(
      "Readiness: 100 of 124 currently stale · target 12/week · This week 10 open · 2 complete"
    );
  });

  it("handles empty topology", () => {
    expect(
      composeFloorReadinessLine({ totalBays: 0, staleCount: 0 })
    ).toBe("Readiness: no mapped bays yet");
  });
});
