/**
 * UX-REDUCE-002 + RD-4 — Floor "This Week" ownership / command composition.
 *
 * Pure presentation composer. Authoritative ownership remains
 * sunday_bay_assignments + weekly_rotations. Physical-bay identity is
 * BAY-UNIT-002. Does not persist, invent owners, or change engine semantics.
 *
 * RD-4: summary separates planned / assigned / completion evidence / verified.
 * Assignment ≠ proof of work. Section stewardship ≠ weekly ownership.
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
import type { BaySectionLookup } from "./operational-sections";
import { resolveOwnershipRecoveryGoal } from "./weekly-stage-draw";
import {
  rosterFloorBadgeLabel,
  type StoreSpecialist,
} from "@/lib/types";

export { BASE_WEEKLY_BAY_QUOTA };

/**
 * Blueprint shared team model: four people × three bays = 12.
 * Engine stages `eligibleAssociateCount × BASE_WEEKLY_BAY_QUOTA` (not a hard
 * constant). Presentation cites the shared model without rewriting dispatch.
 */
export const SHARED_TEAM_CAPACITY_SLOTS = 4;
export const SHARED_TEAM_WEEKLY_CAPACITY =
  SHARED_TEAM_CAPACITY_SLOTS * BASE_WEEKLY_BAY_QUOTA;

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
  /** True when sunday_bay_assignments names an owner for this rotation. */
  isAssigned: boolean;
  /** RD-3 stewardship overlay — independent of weekly assignee. Permanent owner, never the week cover. */
  section?: BaySectionLookup | null;
  /**
   * SECTION-OWNERSHIP-006 — presentation only.
   * Absent coverage stays `none` so a normal assignment keeps its existing line.
   */
  coveragePresentation: ThisWeekCoveragePresentation;
  /** ZEBRA-HANDOFF-002 — operator-recorded Zebra entry (not completion). */
  zebraEnteredAt: string | null;
  zebraEnteredBy: string | null;
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
  reportedCompleteCount: number;
  /** Assigned bays not yet confirmed entered in Zebra. */
  zebraPendingCount: number;
  /** Assigned bays with operator Zebra confirmation. */
  zebraEnteredCount: number;
  /** True when this owner already holds base quota and plan ownership is complete. */
  canAddAnotherBay: boolean;
  /** Roster member present for coordination with zero assigned bays this week. */
  isRosterPlaceholder?: boolean;
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
  /** Assigned physical bays lacking operator Zebra confirmation. */
  zebraPendingCount: number;
  /** Assigned physical bays with operator Zebra confirmation. */
  zebraEnteredCount: number;
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
  /**
   * When true (RD-4 default for supervisor board), include active associate
   * roster rows even if they own zero bays — coordination, not scoring.
   */
  includeUnassignedRoster?: boolean;
  /** RD-3 physicalBayKey → section lookup (optional). Permanent owners only. */
  baySectionByKey?: Map<string, BaySectionLookup>;
  /**
   * Active coverage rows for `weekLabel` only.
   * Null or omitted withholds cover labels. Never used to choose the assignee.
   */
  weekCoverage?: readonly ThisWeekCoverageRecord[] | null;
  weekLabel?: string | null;
  /**
   * OPERATIONAL-009 — when capacity approvals set a shared target, ownership
   * recovery is complete once owned >= min(staged, approvedSharedTarget).
   * Excess staged rows beyond approved capacity do not force recovery chrome.
   */
  approvedSharedTarget?: number | null;
};

/** Evidence-first weekly command board summary (RD-4). */
export type ThisWeekCommandSummary = {
  weekLabel: string | null;
  /** Staged physical bays in the active plan (planned work). */
  plannedBayCount: number;
  /** Physical bays with a Sunday owner (assigned — not completion). */
  assignedBayCount: number;
  /** Staged but still lacking an owner. */
  unassignedBayCount: number;
  /** Associate-reported complete (includes awaiting verification). Not verified. */
  reportedCompleteCount: number;
  /** Operator-verified complete. */
  verifiedCount: number;
  /** Still open / barrier — work remaining. */
  remainingBayCount: number;
  awaitingVerificationCount: number;
  barrierBayCount: number;
  zebraPendingCount: number;
  zebraEnteredCount: number;
  /** Blueprint shared pool citation (4×3). Engine may stage eligible×3. */
  sharedCapacityBays: number;
  sharedCapacitySlots: number;
  baysPerPerson: number;
  ownershipComplete: boolean;
  hasPlan: boolean;
  /** One-line evidence summary for chrome. */
  headline: string;
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

export type ThisWeekCoverageRecord = {
  section_id: string;
  week_label: string;
  covering_specialist_id: string;
  covering_specialist_name?: string | null;
};

export type ThisWeekCoveragePresentation =
  | { kind: "none" }
  | { kind: "withheld"; reason: ThisWeekCoverageWithholdReason }
  | {
      kind: "covering";
      assignedName: string;
      permanentOwnerName: string | null;
    }
  | {
      kind: "assigned_while_other_covers";
      assignedName: string;
      permanentOwnerName: string | null;
      coveringName: string;
    };

export type ThisWeekCoverageWithholdReason =
  | "ambiguous_coverage"
  | "missing_cover_name";

/**
 * One active cover per section for the selected week.
 * Other weeks are ignored. Two rows for the same section are ambiguous.
 */
export function indexWeekCoverageForLabel(
  records: readonly ThisWeekCoverageRecord[] | null | undefined,
  weekLabel: string | null | undefined
): Map<string, ThisWeekCoverageRecord | "ambiguous"> | null {
  if (records == null) return null;
  const week = String(weekLabel ?? "").trim();
  const map = new Map<string, ThisWeekCoverageRecord | "ambiguous">();
  if (!week) return map;
  for (const raw of records) {
    if (String(raw.week_label ?? "").trim() !== week) continue;
    const sectionId = String(raw.section_id ?? "").trim();
    const coverId = String(raw.covering_specialist_id ?? "").trim();
    if (!sectionId || !coverId) continue;
    if (map.has(sectionId)) {
      map.set(sectionId, "ambiguous");
      continue;
    }
    const name = String(raw.covering_specialist_name ?? "").trim();
    map.set(sectionId, {
      section_id: sectionId,
      week_label: week,
      covering_specialist_id: coverId,
      covering_specialist_name: name || null,
    });
  }
  return map;
}

/**
 * Label temporary coverage without changing who is assigned.
 * A cover row is not an assignment. The permanent owner field is not replaced.
 */
export function presentTemporaryCoverage(input: {
  isAssigned: boolean;
  assignedSpecialistId: string;
  assignedName: string;
  section: BaySectionLookup | null | undefined;
  coverage: ThisWeekCoverageRecord | "ambiguous" | null | undefined;
}): ThisWeekCoveragePresentation {
  if (!input.isAssigned) return { kind: "none" };
  const assignedId = String(input.assignedSpecialistId ?? "").trim();
  if (!assignedId) return { kind: "none" };
  if (input.coverage === "ambiguous") {
    return { kind: "withheld", reason: "ambiguous_coverage" };
  }
  if (!input.coverage || !input.section) return { kind: "none" };

  const permanentId = String(input.section.primary_owner_specialist_id ?? "").trim();
  const permanentName = String(input.section.primary_owner_name ?? "").trim();
  const coverId = String(input.coverage.covering_specialist_id ?? "").trim();
  if (!coverId) return { kind: "none" };
  if (permanentId && coverId === permanentId) return { kind: "none" };

  const assignedName = String(input.assignedName ?? "").trim() || "Team member";
  if (coverId === assignedId) {
    return {
      kind: "covering",
      assignedName,
      permanentOwnerName: permanentName || null,
    };
  }

  const coverName = String(input.coverage.covering_specialist_name ?? "").trim();
  if (!coverName) return { kind: "withheld", reason: "missing_cover_name" };
  return {
    kind: "assigned_while_other_covers",
    assignedName,
    permanentOwnerName: permanentName || null,
    coveringName: coverName,
  };
}

/** Lines shown on a bay only when temporary coverage changes the label. */
export function temporaryCoverageLines(
  presentation: ThisWeekCoveragePresentation,
  assignedName: string
): string[] | null {
  const name = String(assignedName ?? "").trim() || "Team member";
  if (presentation.kind === "covering") {
    return [
      `Assigned to ${name}`,
      presentation.permanentOwnerName
        ? `Permanent owner ${presentation.permanentOwnerName}`
        : "Permanent owner unavailable",
      "Covering this week",
    ];
  }
  if (presentation.kind === "assigned_while_other_covers") {
    const lines = [`Assigned to ${name}`];
    if (presentation.permanentOwnerName) {
      lines.push(`Permanent owner ${presentation.permanentOwnerName}`);
    }
    lines.push(`${presentation.coveringName} covering this week`);
    return lines;
  }
  return null;
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
  const coverageBySection = indexWeekCoverageForLabel(
    input.weekCoverage,
    input.weekLabel
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
    const assignmentRow = input.assignments[rotation.id];
    const assigned = Boolean(
      String(assignmentRow?.specialist_id ?? "").trim()
    );
    const section = input.baySectionByKey?.get(key) ?? null;
    const assignedId = String(assignmentRow?.specialist_id ?? "").trim();
    const coveragePresentation = presentTemporaryCoverage({
      isAssigned: assigned,
      assignedSpecialistId: assignedId,
      assignedName: ownerNameFromAssignment(assignmentRow, rosterById),
      section,
      coverage: section
        ? coverageBySection?.get(String(section.section_id)) ?? null
        : null,
    });
    const next: ThisWeekOwnedBay = {
      physicalKey: key,
      aisle,
      bay: Number(bay) || 0,
      label: loc ? formatBayTag(loc) : `Bay ${String(rotation.location_id).slice(0, 8)}`,
      rotation,
      lifecycle: lifecycleFor(rotation, hasBarrier),
      hasBarrier,
      isAssigned: assigned,
      section,
      coveragePresentation,
      zebraEnteredAt: assigned
        ? assignmentRow?.zebra_entered_at
          ? String(assignmentRow.zebra_entered_at)
          : null
        : null,
      zebraEnteredBy: assigned
        ? assignmentRow?.zebra_entered_by
          ? String(assignmentRow.zebra_entered_by)
          : null
        : null,
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
  let zebraPendingCount = 0;
  let zebraEnteredCount = 0;

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

    if (bay.zebraEnteredAt) zebraEnteredCount += 1;
    else zebraPendingCount += 1;

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
        reportedCompleteCount: 0,
        zebraPendingCount: 0,
        zebraEnteredCount: 0,
        canAddAnotherBay: false,
      };
      ownersById.set(specialistId, owner);
    }
    owner.bays.push(bay);
    owner.isRosterPlaceholder = false;
    if (bay.zebraEnteredAt) owner.zebraEnteredCount += 1;
    else owner.zebraPendingCount += 1;
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
    if (
      bay.lifecycle === "reported" ||
      bay.lifecycle === "awaiting_verification"
    ) {
      owner.reportedCompleteCount += 1;
    }
  }

  if (input.includeUnassignedRoster) {
    for (const member of input.roster ?? []) {
      if (!member.is_active) continue;
      if (member.role === "MasterAdmin") continue;
      // Coordination view: associates + specialists (and supervisors who own work).
      const id = String(member.id ?? "").trim();
      if (!id || ownersById.has(id)) continue;
      if (member.role === "Supervisor") continue;
      ownersById.set(id, {
        specialistId: id,
        specialistName: member.name?.trim() || "Team member",
        roleLabel: roleLabelFor(id, rosterById),
        bays: [],
        awaitingVerificationCount: 0,
        barrierCount: 0,
        openCount: 0,
        verifiedCount: 0,
        reportedCompleteCount: 0,
        zebraPendingCount: 0,
        zebraEnteredCount: 0,
        canAddAnotherBay: false,
        isRosterPlaceholder: true,
      });
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
  const ownershipGoal = resolveOwnershipRecoveryGoal({
    stagedPhysicalBayCount: physicalBays.length,
    approvedSharedTarget: input.approvedSharedTarget,
  });
  const ownershipComplete =
    hasPlan && ownedPhysicalBayCount >= ownershipGoal && ownershipGoal > 0;
  const needsOwnershipRecovery = hasPlan && ownedPhysicalBayCount < ownershipGoal;
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
    zebraPendingCount,
    zebraEnteredCount,
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
  if (!plan.hasPlan) return "No bays planned this week";
  const parts = [
    `${plan.physicalBayCount} planned`,
    `${plan.ownedPhysicalBayCount} assigned`,
    `${plan.verifiedCount} verified`,
  ];
  if (plan.zebraPendingCount > 0) {
    parts.push(`${plan.zebraPendingCount} not in Zebra`);
  }
  if (plan.pendingVerificationCount > 0) {
    parts.push(
      `${plan.pendingVerificationCount} awaiting verification`
    );
  } else if (plan.openCount > 0) {
    parts.push(`${plan.openCount} remaining`);
  }
  return parts.join(" · ");
}

/**
 * RD-4 command summary — answers planned / assigned / completed / remaining
 * from existing ownership evidence. Does not invent capacity or completions.
 */
export function composeThisWeekCommandSummary(
  plan: ThisWeekOwnershipPlan,
  weekLabel: string | null = null
): ThisWeekCommandSummary {
  const plannedBayCount = plan.physicalBayCount;
  const assignedBayCount = plan.ownedPhysicalBayCount;
  const unassignedBayCount = plan.unownedPhysicalBayCount;
  const remainingBayCount = plan.openCount;
  const headline = composeThisWeekProgressLine(plan);

  return {
    weekLabel,
    plannedBayCount,
    assignedBayCount,
    unassignedBayCount,
    reportedCompleteCount: plan.reportedCompleteCount,
    verifiedCount: plan.verifiedCount,
    remainingBayCount,
    awaitingVerificationCount: plan.pendingVerificationCount,
    barrierBayCount: plan.barrierBayCount,
    zebraPendingCount: plan.zebraPendingCount,
    zebraEnteredCount: plan.zebraEnteredCount,
    sharedCapacityBays: SHARED_TEAM_WEEKLY_CAPACITY,
    sharedCapacitySlots: SHARED_TEAM_CAPACITY_SLOTS,
    baysPerPerson: BASE_WEEKLY_BAY_QUOTA,
    ownershipComplete: plan.ownershipComplete,
    hasPlan: plan.hasPlan,
    headline,
  };
}

/** Assignment responsibility — never implies work occurred. */
export function assignmentResponsibilityLabel(bay: ThisWeekOwnedBay): string {
  return bay.isAssigned ? "Assigned this week" : "Planned — unowned";
}

/** Completion / verification evidence language (separate from assignment). */
export function completionEvidenceLabel(lifecycle: PhysicalBayLifecycle): string {
  switch (lifecycle) {
    case "verified":
      return "Verified complete";
    case "awaiting_verification":
      return "Reported — awaiting verification";
    case "reported":
      return "Reported complete";
    case "barrier":
      return "Barrier — coverage still owed";
    default:
      return "No completion evidence";
  }
}

/** Zebra handoff label — operator-recorded only; never implies Zebra acceptance. */
export function zebraHandoffEvidenceLabel(bay: ThisWeekOwnedBay): string {
  if (!bay.isAssigned) return "Zebra entry — needs owner first";
  if (bay.zebraEnteredAt) return "Entered in Zebra";
  return "Not entered in Zebra";
}
