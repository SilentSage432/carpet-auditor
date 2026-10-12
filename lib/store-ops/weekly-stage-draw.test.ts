/**
 * OPERATIONAL-009 — stage draw + ownership recovery goal.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveOwnershipRecoveryGoal,
  resolveWeeklyStageDrawCount,
} from "./weekly-stage-draw";
import { composeThisWeekOwnership } from "./this-week-ownership";
import type { SundayAssignmentMap } from "./sunday-audit";
import type { WeeklyRotationWithLocation } from "./types";

const root = join(__dirname, "../..");

function loc(id: string, aisle: string, bayNum: number) {
  return {
    id,
    store_id: "s1",
    department_id: "dept-1",
    aisle,
    bay: bayNum,
    type: "SELLING" as const,
    status: "PENDING",
    is_active: true,
    location_type: "STANDARD" as const,
  };
}

function bay(
  id: string,
  aisle: string,
  bayNum: number
): WeeklyRotationWithLocation {
  const location = loc(`loc-${id}`, aisle, bayNum);
  return {
    id,
    store_id: "s1",
    department_id: location.department_id,
    location_id: location.id,
    assigned_week: "2026-W42",
    is_completed: false,
    verification_status: "PENDING",
    store_locations: location as WeeklyRotationWithLocation["store_locations"],
  } as WeeklyRotationWithLocation;
}

describe("resolveWeeklyStageDrawCount", () => {
  it("uses approved shared target when approvals complete", () => {
    expect(
      resolveWeeklyStageDrawCount({
        eligibleAssociateCount: 4,
        approvalsComplete: true,
        sharedTargetApproved: 11,
      })
    ).toBe(11);
  });

  it("falls back to eligible × 3 when capacity not approved", () => {
    expect(
      resolveWeeklyStageDrawCount({
        eligibleAssociateCount: 4,
        approvalsComplete: false,
        sharedTargetApproved: 11,
      })
    ).toBe(12);
  });
});

describe("resolveOwnershipRecoveryGoal", () => {
  it("caps recovery goal at approved shared target", () => {
    expect(
      resolveOwnershipRecoveryGoal({
        stagedPhysicalBayCount: 12,
        approvedSharedTarget: 11,
      })
    ).toBe(11);
  });

  it("requires full staged ownership without approved target", () => {
    expect(
      resolveOwnershipRecoveryGoal({
        stagedPhysicalBayCount: 12,
        approvedSharedTarget: null,
      })
    ).toBe(12);
  });
});

describe("composeThisWeekOwnership approvedSharedTarget", () => {
  it("does not force recovery when owned meets approved target with excess staged", () => {
    const rotations = Array.from({ length: 12 }, (_, i) =>
      bay(`r${i}`, String(5 + (i % 2)), i + 1)
    );
    const assignments: SundayAssignmentMap = {};
    for (let i = 0; i < 11; i += 1) {
      assignments[rotations[i].id] = {
        specialist_id: `s${i % 4}`,
        specialist_name: `A${i % 4}`,
        assigned_at: "2026-10-12T12:00:00Z",
      };
    }
    const plan = composeThisWeekOwnership({
      rotations,
      assignments,
      approvedSharedTarget: 11,
    });
    expect(plan.ownedPhysicalBayCount).toBe(11);
    expect(plan.unownedPhysicalBayCount).toBe(1);
    expect(plan.needsOwnershipRecovery).toBe(false);
    expect(plan.ownershipComplete).toBe(true);
  });

  it("requires ownership when below approved target", () => {
    const rotations = Array.from({ length: 12 }, (_, i) =>
      bay(`r${i}`, "5", i + 1)
    );
    const plan = composeThisWeekOwnership({
      rotations,
      assignments: {},
      approvedSharedTarget: 11,
    });
    expect(plan.needsOwnershipRecovery).toBe(true);
    expect(plan.ownershipComplete).toBe(false);
  });
});

describe("Sunday assign path OPERATIONAL-009 contracts", () => {
  const modal = readFileSync(
    join(root, "components/admin/SundayAuditAssignmentModal.tsx"),
    "utf8"
  );

  it("blocks legacy balancer from persisting new assignments", () => {
    const start = modal.indexOf("async function handleBalanceAssign(");
    const brace = modal.indexOf("{", start);
    let depth = 0;
    let end = brace;
    for (let i = brace; i < modal.length; i += 1) {
      if (modal[i] === "{") depth += 1;
      if (modal[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = modal.slice(brace, end + 1);
    expect(body).toMatch(/composeStewardshipWeeklyProposal/);
    expect(body).toMatch(/approvals_complete/);
    expect(body).not.toMatch(/buildScheduleBalancePlan/);
    expect(body).not.toMatch(/composeSectionAwareWeeklyPreview/);
    expect(modal).toMatch(/SECTION_AWARE_ROTATION_AUTO_STAGE|isSectionAwarePreviewEnabled/);
  });

  it("stages with approved shared capacity when available", () => {
    expect(modal).toMatch(/resolveWeeklyStageDrawCount/);
  });

  it("keeps Sunday auto-stage hard off", () => {
    const aware = readFileSync(
      join(root, "lib/store-ops/section-aware-rotation.ts"),
      "utf8"
    );
    expect(aware).toMatch(/SECTION_AWARE_ROTATION_AUTO_STAGE\s*=\s*false/);
  });
});
