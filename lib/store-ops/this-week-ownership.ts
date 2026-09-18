/**
 * UX-REDUCE-002 — Floor "This Week" ownership composition.
 *
 * Pure presentation composer. Authoritative ownership remains
 * sunday_bay_assignments + weekly_rotations. Physical-bay identity is
 * BAY-UNIT-002. Does not persist, invent owners, or change engine semantics.
 */

import { normalizeAisle } from "./aisle";
import { physicalBayKey } from "./physical-bay";
import { filterActiveWeeklyRotations } from "./rotation-history";
import {
  isRotationPendingVerification,
  isRotationReportedComplete,
  isRotationVerifiedComplete,
} from "./rotation-metrics";
import type { SundayAssignmentMap } from "./sunday-audit";
import { formatBayTag, type WeeklyRotationWithLocation } from "./types";
import { BASE_WEEKLY_BAY_QUOTA } from "./weekly-rotations";
import {
  rosterFloorBadgeLabel,
  type StoreSpecialist,
} from "@/lib/types";

export { BASE_WEEKLY_BAY_QUOTA };

export type PhysicalBayLifecycle =
  | "open"
  | "reported"
  | "awaiting_verification"
  | "verified"
  | "barrier";

export type ThisWeekOwnedBay = {
  physicalKey: string;
  aisle: string;
  bay: number;
  label: string;
  rotation: WeeklyRotationWithLocation;
  lifecycle: PhysicalBayLifecycle;
  hasBarrier: boolean;
};

export type ThisWeekOwner = {
  specialistId: string;
  specialistName: string;
  roleLabel: string | null;
  bays: ThisWeekOwnedBay[];
  awaitingVerificationCount: number;
  barrierCount: number;
  openCount: number;
  verifiedCount: number;
  /** True when this owner already holds base quota and plan ownership is complete. */
  canAddAnotherBay: boolean;
};

export type ThisWeekOwnershipPlan = {
  owners: ThisWeekOwner[];
  unownedBays: ThisWeekOwnedBay[];
  physicalBayCount: number;
  ownedPhysicalBayCount: number;
  unownedPhysicalBayCount: number;
  ownershipComplete: boolean;
  hasPlan: boolean;
  pendingVerificationCount: number;
  barrierBayCount: number;
  verifiedCount: number;
  reportedCompleteCount: number;
  openCount: number;
  /** Staged rotations exist but at least one physical bay lacks an owner. */
  needsOwnershipRecovery: boolean;
  /** No active weekly rotations in scope. */
  needsDispatchRecovery: boolean;
  /** Healthy owned plan — recovery chrome should stay quiet. */
  isHealthyOwnedPlan: boolean;
};

export type ComposeThisWeekOwnershipInput = {
  rotations: WeeklyRotationWithLocation[];
  assignments: SundayAssignmentMap;
  roster?: StoreSpecialist[];
  /** Rotation ids with an open barrier/exception this week. */
  barrierRotationIds?: Iterable<string>;
};

function compareAisleBay(a: ThisWeekOwnedBay, b: ThisWeekOwnedBay): number {
  const aisle = a.aisle.localeCompare(b.aisle, undefined, { numeric: true });
  if (aisle !== 0) return aisle;
  return a.bay - b.bay;
}

function lifecycleFor(
  rotation: WeeklyRotationWithLocation,
  hasBarrier: boolean
): PhysicalBayLifecycle {
  if (isRotationVerifiedComplete(rotation)) return "verified";
  if (isRotationPendingVerification(rotation)) return "awaiting_verification";
  if (hasBarrier) return "barrier";
  if (isRotationReportedComplete(rotation)) return "reported";
  return "open";
}

function ownerNameFromAssignment(
  assignment: SundayAssignmentMap[string] | null | undefined,
  rosterById: Map<string, StoreSpecialist>
): string {
  const id = String(assignment?.specialist_id ?? "").trim();
  const fromRoster = id ? rosterById.get(id)?.name?.trim() : "";
  if (fromRoster) return fromRoster;
  const fromAssignment = String(assignment?.specialist_name ?? "").trim();
  return fromAssignment || "Team member";
}

function roleLabelFor(
  specialistId: string,
  rosterById: Map<string, StoreSpecialist>
): string | null {
  const member = rosterById.get(specialistId);
  if (!member) return null;
  return rosterFloorBadgeLabel(member);
}

/**
 * Compose people → physical bays from active weekly rotations + persisted
 * Sunday ownership. Sibling SELLING/TOPSTOCK surfaces collapse to one bay
 * when both somehow appear (defensive; BAY-UNIT stages one row per bay).
 */
export function composeThisWeekOwnership(
  input: ComposeThisWeekOwnershipInput
): ThisWeekOwnershipPlan {
  const active = filterActiveWeeklyRotations(input.rotations ?? []);
  const barrierSet = new Set(
    [...(input.barrierRotationIds ?? [])].map((id) => String(id))
  );
  const rosterById = new Map(
    (input.roster ?? []).map((m) => [String(m.id), m] as const)
  );

  const byPhysical = new Map<string, ThisWeekOwnedBay>();

  for (const rotation of active) {
    const loc = rotation.store_locations;
    const departmentId = String(
      rotation.department_id || loc?.department_id || ""
    );
    const aisle = loc ? normalizeAisle(loc.aisle) : "—";
    const bay = loc?.bay ?? 0;
    const key =
      departmentId && loc
        ? physicalBayKey({
            department_id: departmentId,
            aisle,
            bay,
          })
        : `rotation:${rotation.id}`;

    const hasBarrier = barrierSet.has(String(rotation.id));
    const next: ThisWeekOwnedBay = {
      physicalKey: key,
      aisle,
      bay: Number(bay) || 0,
      label: loc ? formatBayTag(loc) : `Bay ${String(rotation.location_id).slice(0, 8)}`,
      rotation,
      lifecycle: lifecycleFor(rotation, hasBarrier),
      hasBarrier,
    };

    const existing = byPhysical.get(key);
    if (!existing) {
      byPhysical.set(key, next);
      continue;
    }
    // Prefer the row that still owes attention / has ownership evidence.
    const rank = (bayRow: ThisWeekOwnedBay) => {
      if (bayRow.lifecycle === "awaiting_verification") return 4;
      if (bayRow.lifecycle === "barrier") return 3;
      if (bayRow.lifecycle === "open") return 2;
      if (bayRow.lifecycle === "reported") return 1;
      return 0;
    };
    if (rank(next) > rank(existing)) {
      byPhysical.set(key, next);
    }
  }

  const physicalBays = [...byPhysical.values()].sort(compareAisleBay);
  const ownersById = new Map<string, ThisWeekOwner>();
  const unownedBays: ThisWeekOwnedBay[] = [];

  let pendingVerificationCount = 0;
  let barrierBayCount = 0;
  let verifiedCount = 0;
  let reportedCompleteCount = 0;
  let openCount = 0;

  for (const bay of physicalBays) {
    if (bay.lifecycle === "awaiting_verification") pendingVerificationCount += 1;
    if (bay.hasBarrier || bay.lifecycle === "barrier") barrierBayCount += 1;
    if (bay.lifecycle === "verified") verifiedCount += 1;
    if (bay.lifecycle === "reported" || bay.lifecycle === "awaiting_verification") {
      reportedCompleteCount += 1;
    }
    if (bay.lifecycle === "open" || bay.lifecycle === "barrier") openCount += 1;

    const assignment = input.assignments[bay.rotation.id] ?? null;
    const specialistId = String(assignment?.specialist_id ?? "").trim();
    if (!specialistId) {
      unownedBays.push(bay);
      continue;
    }

    let owner = ownersById.get(specialistId);
    if (!owner) {
      owner = {
        specialistId,
        specialistName: ownerNameFromAssignment(assignment, rosterById),
        roleLabel: roleLabelFor(specialistId, rosterById),
        bays: [],
        awaitingVerificationCount: 0,
        barrierCount: 0,
        openCount: 0,
        verifiedCount: 0,
        canAddAnotherBay: false,
      };
      ownersById.set(specialistId, owner);
    }
    owner.bays.push(bay);
    if (bay.lifecycle === "awaiting_verification") {
      owner.awaitingVerificationCount += 1;
    }
    if (bay.hasBarrier || bay.lifecycle === "barrier") {
      owner.barrierCount += 1;
    }
    if (bay.lifecycle === "open" || bay.lifecycle === "barrier") {
      owner.openCount += 1;
    }
    if (bay.lifecycle === "verified") {
      owner.verifiedCount += 1;
    }
  }

  for (const owner of ownersById.values()) {
    owner.bays.sort(compareAisleBay);
  }

  const owners = [...ownersById.values()].sort((a, b) =>
    a.specialistName.localeCompare(b.specialistName, undefined, {
      sensitivity: "base",
    })
  );

  const hasPlan = physicalBays.length > 0;
  const unownedPhysicalBayCount = unownedBays.length;
  const ownedPhysicalBayCount = physicalBays.length - unownedPhysicalBayCount;
  const ownershipComplete = hasPlan && unownedPhysicalBayCount === 0;
  const needsOwnershipRecovery = hasPlan && !ownershipComplete;
  const needsDispatchRecovery = !hasPlan;
  const isHealthyOwnedPlan = ownershipComplete;

  for (const owner of owners) {
    owner.canAddAnotherBay =
      isHealthyOwnedPlan && owner.bays.length >= BASE_WEEKLY_BAY_QUOTA;
  }

  return {
    owners,
    unownedBays,
    physicalBayCount: physicalBays.length,
    ownedPhysicalBayCount,
    unownedPhysicalBayCount,
    ownershipComplete,
    hasPlan,
    pendingVerificationCount,
    barrierBayCount,
    verifiedCount,
    reportedCompleteCount,
    openCount,
    needsOwnershipRecovery,
    needsDispatchRecovery,
    isHealthyOwnedPlan,
  };
}

export function physicalBayLifecycleLabel(
  lifecycle: PhysicalBayLifecycle
): string {
  switch (lifecycle) {
    case "awaiting_verification":
      return "Awaiting verification";
    case "verified":
      return "Verified";
    case "barrier":
      return "Barrier";
    case "reported":
      return "Reported complete";
    default:
      return "Open";
  }
}

/** Compact week progress for Floor — no staging/target machinery language. */
export function composeThisWeekProgressLine(plan: ThisWeekOwnershipPlan): string {
  if (!plan.hasPlan) return "No bays assigned this week";
  const parts = [
    `${plan.physicalBayCount} assigned`,
    `${plan.verifiedCount} verified`,
  ];
  if (plan.pendingVerificationCount > 0) {
    parts.push(
      `${plan.pendingVerificationCount} awaiting verification`
    );
  } else if (plan.openCount > 0) {
    parts.push(`${plan.openCount} open`);
  }
  return parts.join(" · ");
}
