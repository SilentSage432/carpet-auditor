/**
 * OPERATIONAL-009 — stage draw count for Sunday recovery staging.
 * When capacity is approved, stage exactly the shared approved target so
 * stewardship can own every staged bay without excess unowned leftovers.
 */

import { resolveAutomaticWeeklyBayTarget } from "./week";
import { BASE_WEEKLY_BAY_QUOTA } from "./weekly-rotations";

export { BASE_WEEKLY_BAY_QUOTA };

export function resolveWeeklyStageDrawCount(input: {
  eligibleAssociateCount: number;
  approvalsComplete: boolean;
  sharedTargetApproved: number | null | undefined;
  /** Legacy fallback when schedules unknown (historical Stage button default). */
  fallbackWhenUnknown?: number;
}): number {
  if (
    input.approvalsComplete &&
    input.sharedTargetApproved != null &&
    Number.isFinite(input.sharedTargetApproved)
  ) {
    return Math.max(0, Math.floor(input.sharedTargetApproved));
  }
  if (input.eligibleAssociateCount > 0) {
    return resolveAutomaticWeeklyBayTarget(
      input.eligibleAssociateCount,
      BASE_WEEKLY_BAY_QUOTA
    );
  }
  return Math.max(0, Math.floor(input.fallbackWhenUnknown ?? 12));
}

/**
 * Ownership recovery goal: fill approved shared capacity, not excess staged rows.
 * When no approved target, every staged bay must be owned (legacy).
 */
export function resolveOwnershipRecoveryGoal(input: {
  stagedPhysicalBayCount: number;
  approvedSharedTarget: number | null | undefined;
}): number {
  const staged = Math.max(0, Math.floor(input.stagedPhysicalBayCount));
  if (
    input.approvedSharedTarget == null ||
    !Number.isFinite(input.approvedSharedTarget)
  ) {
    return staged;
  }
  return Math.min(staged, Math.max(0, Math.floor(input.approvedSharedTarget)));
}
