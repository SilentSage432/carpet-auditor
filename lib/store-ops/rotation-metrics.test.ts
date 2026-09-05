import { describe, expect, it } from "vitest";
import {
  composeWeeklyRotationMetrics,
  composeFloorWeekProgressLine,
  isRotationPendingVerification,
  isRotationReportedComplete,
  isRotationVerifiedComplete,
  isWeekVerifiedForMapOverlay,
  verificationLagMs,
  WEEKLY_ROTATION_METRICS_METHOD,
} from "@/lib/store-ops/rotation-metrics";
import { composeFloorReadinessLine } from "@/lib/store-ops/floor-readiness";

function row(
  partial: Partial<{
    is_completed: boolean;
    verification_status: string | null;
    completed_at: string | null;
    verified_at: string | null;
  }>
) {
  return {
    is_completed: false,
    verification_status: "PENDING" as const,
    completed_at: null,
    verified_at: null,
    ...partial,
  };
}

describe("weekly-rotation-metrics-v1", () => {
  it("Case A — staged, not completed", () => {
    const metrics = composeWeeklyRotationMetrics({
      rotations: [row({ verification_status: "PENDING", is_completed: false })],
      weeklyTarget: 10,
    });
    expect(metrics.method).toBe(WEEKLY_ROTATION_METRICS_METHOD);
    expect(metrics.staged).toBe(1);
    expect(metrics.reportedComplete).toBe(0);
    expect(metrics.pendingVerification).toBe(0);
    expect(metrics.verifiedComplete).toBe(0);
    expect(metrics.open).toBe(1);
  });

  it("Case B — reported complete / pending verification", () => {
    const metrics = composeWeeklyRotationMetrics({
      rotations: [
        row({
          is_completed: true,
          verification_status: "PENDING_VERIFICATION",
          completed_at: "2026-09-04T12:00:00.000Z",
        }),
      ],
      weeklyTarget: 10,
    });
    expect(metrics.reportedComplete).toBe(1);
    expect(metrics.pendingVerification).toBe(1);
    expect(metrics.verifiedComplete).toBe(0);
    expect(metrics.open).toBe(1);
    expect(
      isRotationPendingVerification(
        row({
          is_completed: true,
          verification_status: "PENDING_VERIFICATION",
        })
      )
    ).toBe(true);
    expect(
      isRotationReportedComplete(
        row({
          is_completed: true,
          verification_status: "PENDING_VERIFICATION",
        })
      )
    ).toBe(true);
  });

  it("Case C — verified complete", () => {
    const metrics = composeWeeklyRotationMetrics({
      rotations: [
        row({
          is_completed: true,
          verification_status: "VERIFIED_COMPLETE",
          completed_at: "2026-09-04T12:00:00.000Z",
          verified_at: "2026-09-04T15:00:00.000Z",
        }),
      ],
      weeklyTarget: 10,
    });
    expect(metrics.reportedComplete).toBe(1);
    expect(metrics.verifiedComplete).toBe(1);
    expect(metrics.pendingVerification).toBe(0);
    expect(metrics.open).toBe(0);
    expect(
      isRotationVerifiedComplete(
        row({
          is_completed: true,
          verification_status: "VERIFIED_COMPLETE",
        })
      )
    ).toBe(true);
  });

  it("Case D — verified target deficit", () => {
    const rotations = Array.from({ length: 6 }, () =>
      row({
        is_completed: true,
        verification_status: "VERIFIED_COMPLETE",
      })
    );
    const metrics = composeWeeklyRotationMetrics({
      rotations,
      weeklyTarget: 10,
    });
    expect(metrics.verifiedComplete).toBe(6);
    expect(metrics.verifiedTargetDeficit).toBe(4);
  });

  it("Case E — reported pending must not reduce verified target deficit", () => {
    const rotations = [
      ...Array.from({ length: 6 }, () =>
        row({
          is_completed: true,
          verification_status: "VERIFIED_COMPLETE",
        })
      ),
      ...Array.from({ length: 2 }, () =>
        row({
          is_completed: true,
          verification_status: "PENDING_VERIFICATION",
        })
      ),
    ];
    const metrics = composeWeeklyRotationMetrics({
      rotations,
      weeklyTarget: 10,
    });
    expect(metrics.reportedComplete).toBe(8);
    expect(metrics.pendingVerification).toBe(2);
    expect(metrics.verifiedComplete).toBe(6);
    expect(metrics.verifiedTargetDeficit).toBe(4);
  });

  it("does not treat is_completed alone as verified", () => {
    const metrics = composeWeeklyRotationMetrics({
      rotations: [row({ is_completed: true, verification_status: null })],
      weeklyTarget: 10,
    });
    expect(metrics.reportedComplete).toBe(1);
    expect(metrics.verifiedComplete).toBe(0);
    expect(metrics.verifiedTargetDeficit).toBe(10);
  });

  it("verification lag only when both timestamps exist", () => {
    expect(
      verificationLagMs(
        row({
          is_completed: true,
          verification_status: "VERIFIED_COMPLETE",
          completed_at: "2026-09-04T12:00:00.000Z",
          verified_at: "2026-09-04T14:00:00.000Z",
        })
      )
    ).toBe(2 * 3_600_000);

    expect(
      verificationLagMs(
        row({
          is_completed: true,
          verification_status: "VERIFIED_COMPLETE",
          completed_at: null,
          verified_at: "2026-09-04T14:00:00.000Z",
        })
      )
    ).toBeNull();

    expect(
      verificationLagMs(
        row({
          is_completed: true,
          verification_status: "PENDING_VERIFICATION",
          completed_at: "2026-09-04T12:00:00.000Z",
          verified_at: null,
        })
      )
    ).toBeNull();
  });

  it("Case F — pending verification is not map verified overlay", () => {
    expect(
      isWeekVerifiedForMapOverlay(
        row({
          is_completed: true,
          verification_status: "PENDING_VERIFICATION",
        })
      )
    ).toBe(false);
    expect(
      isWeekVerifiedForMapOverlay(
        row({
          is_completed: true,
          verification_status: "VERIFIED_COMPLETE",
        })
      )
    ).toBe(true);
  });

  it("composeFloorWeekProgressLine stays compact and truthful", () => {
    expect(
      composeFloorWeekProgressLine({
        staged: 12,
        verifiedComplete: 4,
        pendingVerification: 2,
        open: 8,
      })
    ).toBe("12 staged · 4 verified · 2 awaiting review");

    expect(
      composeFloorWeekProgressLine({
        staged: 12,
        verifiedComplete: 10,
        pendingVerification: 0,
        open: 2,
      })
    ).toBe("12 staged · 10 verified · 2 open");

    expect(
      composeFloorWeekProgressLine({
        staged: 0,
        verifiedComplete: 0,
        pendingVerification: 0,
        open: 0,
      })
    ).toBe("No bays staged this week");
  });
});

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

  it("appends verified week context from canonical metrics", () => {
    expect(
      composeFloorReadinessLine({
        totalBays: 124,
        staleCount: 100,
        weeklyTarget: 12,
        weekMetrics: {
          staged: 12,
          verifiedComplete: 2,
          pendingVerification: 3,
          open: 10,
        },
      })
    ).toBe(
      "Readiness: 100 of 124 currently stale · target 12/week · This week 12 staged · 2 verified · 3 awaiting review"
    );
  });

  it("handles empty topology", () => {
    expect(
      composeFloorReadinessLine({ totalBays: 0, staleCount: 0 })
    ).toBe("Readiness: no mapped bays yet");
  });
});
