import { describe, expect, it } from "vitest";
import { shouldShowFloorAttentionSummary } from "@/lib/store-ops/floor-attention-visibility";
import type { LocationAttentionSummary } from "@/lib/store-ops/location-attention-summary";

function summary(
  partial: Partial<LocationAttentionSummary>
): LocationAttentionSummary {
  return {
    eligibleCount: 0,
    noneCount: 0,
    lowCount: 0,
    mediumCount: 0,
    highCount: 0,
    mediumOrHighCount: 0,
    ...partial,
  };
}

describe("shouldShowFloorAttentionSummary", () => {
  it("hides idle/loading and quiet AVAILABLE", () => {
    expect(
      shouldShowFloorAttentionSummary({
        status: "IDLE",
        summary: null,
        degraded: false,
      })
    ).toBe(false);
    expect(
      shouldShowFloorAttentionSummary({
        status: "LOADING",
        summary: null,
        degraded: false,
      })
    ).toBe(false);
    expect(
      shouldShowFloorAttentionSummary({
        status: "AVAILABLE",
        summary: summary({
          noneCount: 10,
          lowCount: 2,
          eligibleCount: 12,
          mediumOrHighCount: 0,
        }),
        degraded: false,
      })
    ).toBe(false);
  });

  it("shows elevated Medium/High and degraded/unavailable gates", () => {
    expect(
      shouldShowFloorAttentionSummary({
        status: "AVAILABLE",
        summary: summary({
          mediumCount: 2,
          highCount: 1,
          mediumOrHighCount: 3,
          eligibleCount: 3,
        }),
        degraded: false,
      })
    ).toBe(true);
    expect(
      shouldShowFloorAttentionSummary({
        status: "DEGRADED",
        summary: summary({ noneCount: 5, eligibleCount: 5 }),
        degraded: true,
      })
    ).toBe(true);
    expect(
      shouldShowFloorAttentionSummary({
        status: "UNAVAILABLE",
        summary: null,
        degraded: false,
      })
    ).toBe(true);
    expect(
      shouldShowFloorAttentionSummary({
        status: "NEEDS_DEPARTMENT",
        summary: null,
        degraded: false,
      })
    ).toBe(true);
  });
});
