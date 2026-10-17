/**
 * DEPTSYNC-ROTATION-AUTO-002/003 — authoritative weekly stage + assign path.
 *
 * One eligibility / capacity / ownership / persistence contract for manual and
 * scheduled execution.
 *
 * AUTO-003: deliberate activation for automatic publication remains OFF by
 * default (`WEEKLY_ROTATION_AUTO_PUBLISH = false`). Env alone cannot enable
 * production publish while the product latch is false. Tests may pass
 * `override: true` only.
 *
 * Does not change capacity values, redistribute sections, or deploy.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertApprovedCapacityReady,
  type CapacityApprovalDraft,
} from "./approved-week-capacity";
import {
  listOperationalSections,
  indexBaySectionLookups,
  type BaySectionLookup,
  type OperationalSectionView,
} from "./operational-sections";
import {
  selectSectionBalancedPhysicalBayCoverage,
  type SectionBalancedStageResult,
  type SectionBalancedStageSlot,
} from "./section-balanced-stage";
import {
  composeStewardshipWeeklyProposal,
  type StewardshipWeeklyProposal,
} from "./stewardship-week-distribution";
import {
  loadStoreWeekCapacity,
  remainingCapMapForEligible,
  type StoreWeekCapacitySnapshot,
} from "./shared-week-capacity";
import type { StoreLocation } from "./types";
import {
  BASE_WEEKLY_BAY_QUOTA,
  type ShiftRosterMember,
} from "./weekly-rotations";
import type { PhysicalBaySelection } from "./physical-bay";
import type { SectionAwareBayRef } from "./section-aware-rotation";
import {
  composeWeekPublicationVisibility,
  type WeekPublicationVisibility,
} from "./week-publication-visibility";

/**
 * Product latch — must stay false until an authorized production enablement
 * tranche flips it. Staging may still run section-balanced.
 * Typed as boolean (not `false as const`) so the dual-gate resolver stays
 * type-correct when the latch is later flipped to true in a controlled tranche.
 */
export const WEEKLY_ROTATION_AUTO_PUBLISH: boolean = false;

/** Env keys for deliberate dual-gate activation (after latch is true). */
export const WEEKLY_ROTATION_AUTO_PUBLISH_ENV =
  "DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH" as const;

export type ResolveAutoPublishInput = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /**
   * Explicit override for unit/integration tests of the publish path.
   * Must never be derived from cron HTTP body / client headers.
   */
  override?: boolean;
};

/**
 * Deliberate activation:
 * 1) `override === true` → enabled (tests / controlled harness only)
 * 2) else product latch must be true
 * 3) else env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH=1` is still ignored
 *    while latch is false (production-safe)
 * 4) when latch is true, env must equal "1" (and never trust request body)
 */
export function resolveWeeklyRotationAutoPublishEnabled(
  input: ResolveAutoPublishInput = {}
): boolean {
  if (input.override === true) return true;
  if (WEEKLY_ROTATION_AUTO_PUBLISH !== true) return false;
  const env = input.env ?? process.env;
  return String(env[WEEKLY_ROTATION_AUTO_PUBLISH_ENV] ?? "").trim() === "1";
}

/** @deprecated use resolveWeeklyRotationAutoPublishEnabled */
export function isWeeklyRotationAutoPublishEnabled(
  flag: boolean = WEEKLY_ROTATION_AUTO_PUBLISH
): boolean {
  return flag === true;
}

export type AuthoritativeStageContext = {
  capacity: StoreWeekCapacitySnapshot;
  baySectionByKey: Map<string, BaySectionLookup>;
  sections: OperationalSectionView[];
  slots: SectionBalancedStageSlot[];
};

export async function loadAuthoritativeStageContext(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    store_number: string;
    week_label: string;
    department_id: string;
    department_codes?: readonly string[];
  }
): Promise<AuthoritativeStageContext | null> {
  const storeId = String(input.store_id ?? "").trim();
  const storeNumber = String(input.store_number ?? "").trim();
  const weekLabel = String(input.week_label ?? "").trim();
  const departmentId = String(input.department_id ?? "").trim();
  if (!storeId || !storeNumber || !weekLabel || !departmentId) return null;

  const codes =
    input.department_codes && input.department_codes.length > 0
      ? input.department_codes
      : ["flooring"];

  const capacity = await loadStoreWeekCapacity(supabase, {
    store_number: storeNumber,
    week_label: weekLabel,
    department_codes: codes,
  });

  if (!capacity.approvals_complete) {
    return null;
  }

  const listed = await listOperationalSections(supabase, {
    store_id: storeId,
    department_id: departmentId,
    includeMembers: true,
  });
  if (!listed.ok || listed.value.length === 0) {
    return null;
  }

  const baySectionByKey = indexBaySectionLookups(listed.value);
  if (baySectionByKey.size === 0) {
    return null;
  }

  const nameById = new Map<string, string>();
  for (const section of listed.value) {
    const oid = String(section.primary_owner_specialist_id ?? "").trim();
    if (oid) {
      nameById.set(
        oid,
        String(section.primary_owner_name ?? "").trim() || oid
      );
    }
  }

  const remaining = remainingCapMapForEligible(capacity);
  const slots: SectionBalancedStageSlot[] = capacity.eligible_specialist_ids
    .map((id) => ({
      specialist_id: id,
      specialist_name: nameById.get(id) ?? id,
      capacity: remaining.get(id) ?? capacity.remaining_by_specialist[id] ?? 0,
    }))
    .filter((s) => s.capacity > 0);

  if (slots.length === 0) {
    return null;
  }

  return {
    capacity,
    baySectionByKey,
    sections: listed.value,
    slots,
  };
}

export function runSectionBalancedStageSelection(input: {
  pending: StoreLocation[];
  carried: StoreLocation[];
  context: AuthoritativeStageContext;
  seasonalHighPhysicalKeys?: Iterable<string> | null;
}): SectionBalancedStageResult {
  return selectSectionBalancedPhysicalBayCoverage({
    pending: input.pending,
    carried: input.carried,
    slots: input.context.slots,
    baySectionByKey: input.context.baySectionByKey,
    seasonalHighPhysicalKeys: input.seasonalHighPhysicalKeys,
  });
}

export type StagedRotationForAssign = {
  id: string;
  department_id: string;
  aisle: string;
  bay: number;
  riskScore?: number;
};

export type AssignmentProtectionEvidence = {
  bay_id: string;
  roster_specialist_id?: string | null;
  assigned_specialist_id?: string | null;
  status?: string | null;
  supervisor_locked?: boolean | null;
};

/**
 * Rotation ids that automatic publication must not change:
 * owned (non-cleared), supervisor-locked (including cleared holds), completed.
 */
export function collectProtectedRotationIds(
  assignments: ReadonlyMap<string, AssignmentProtectionEvidence> | Iterable<AssignmentProtectionEvidence>
): Set<string> {
  const protectedIds = new Set<string>();
  const rows =
    assignments instanceof Map ? assignments.values() : assignments;
  for (const row of rows) {
    const bayId = String(row.bay_id ?? "").trim();
    if (!bayId) continue;
    const status = String(row.status ?? "").trim().toLowerCase();
    if (row.supervisor_locked === true) {
      protectedIds.add(bayId);
      continue;
    }
    if (
      status === "completed" ||
      status === "verified" ||
      status === "verified_complete"
    ) {
      protectedIds.add(bayId);
      continue;
    }
    if (status === "cleared") continue;
    const owned = Boolean(
      String(row.roster_specialist_id ?? "").trim() ||
        String(row.assigned_specialist_id ?? "").trim()
    );
    if (owned) protectedIds.add(bayId);
  }
  return protectedIds;
}

/**
 * Build the same stewardship proposal the Sunday UI persists — for scheduled
 * or recovery assign. Does not write.
 */
export function composeAuthoritativeAssignmentProposal(input: {
  store_number: string;
  week_label: string;
  staged: readonly StagedRotationForAssign[];
  /** Owned + supervisor-locked + completed — skipped by planner. */
  ownedRotationIds: ReadonlySet<string> | readonly string[];
  members: ShiftRosterMember[];
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>;
  capacity: StoreWeekCapacitySnapshot;
}): StewardshipWeeklyProposal {
  assertApprovedCapacityReady({
    approvals_complete: input.capacity.approvals_complete,
    approved_by_specialist: input.capacity.approved_by_specialist,
    eligible_count: input.capacity.eligible_specialist_ids.length,
    shared_target: input.capacity.shared_target,
  });

  const bays: SectionAwareBayRef[] = input.staged.map((row) => ({
    rotationId: row.id,
    department_id: row.department_id,
    aisle: row.aisle,
    bay: row.bay,
    riskScore: row.riskScore ?? 0,
  }));

  return composeStewardshipWeeklyProposal({
    store_number: input.store_number,
    week_label: input.week_label,
    tiers: [],
    bays,
    members: input.members,
    baySectionByKey: input.baySectionByKey,
    ownedRotationIds: input.ownedRotationIds,
    capacity: input.capacity,
    knownHoursOnly: true,
  });
}

/**
 * Pure: filter proposal items so protected rotation ids never appear.
 * Defense in depth beside composeStewardshipWeeklyProposal skip set.
 */
export function filterProposalAwayFromProtected<
  T extends { rotationId: string },
>(items: readonly T[], protectedIds: ReadonlySet<string>): T[] {
  return items.filter((item) => !protectedIds.has(String(item.rotationId)));
}

export function formatStageShortfallSummary(
  result: Pick<
    SectionBalancedStageResult,
    "shortfalls" | "selected_total" | "requested_total"
  >
): string {
  if (result.shortfalls.length === 0) {
    return `Section-balanced stage selected ${result.selected_total}/${result.requested_total}`;
  }
  const parts = result.shortfalls.map((s) => s.reason);
  return `Section-balanced stage selected ${result.selected_total}/${result.requested_total}. Shortfalls: ${parts.join("; ")}`;
}

/**
 * Stamp supervisor_locked after an intentional supervisor edit/clear.
 * No-ops when the column is not migrated yet (fail-open for edits).
 */
export async function stampSupervisorAssignmentLock(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    week_starting: string;
    bay_id: string;
    locked: boolean;
  }
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const store = String(input.store_number ?? "").trim();
  const weekStarting = String(input.week_starting ?? "").trim();
  const bayId = String(input.bay_id ?? "").trim();
  if (!store || !weekStarting || !bayId) {
    return { ok: false, error: "store_number, week_starting, bay_id required" };
  }
  const { error } = await supabase
    .from("sunday_bay_assignments")
    .update({ supervisor_locked: input.locked === true })
    .eq("store_number", store)
    .eq("week_starting", weekStarting)
    .eq("bay_id", bayId);

  if (error) {
    if (/supervisor_locked|column/i.test(error.message)) {
      return { ok: true, skipped: true };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Clear supervisor_locked on system auto-publish writes for newly filled bays.
 * Never clears locks on protected rows (caller must not pass protected bay_ids).
 */
export async function clearSupervisorLocksForPublishedBays(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    week_starting: string;
    bay_ids: readonly string[];
  }
): Promise<void> {
  const ids = [...new Set(input.bay_ids.map((id) => String(id).trim()).filter(Boolean))];
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("sunday_bay_assignments")
    .update({ supervisor_locked: false })
    .eq("store_number", String(input.store_number).trim())
    .eq("week_starting", String(input.week_starting).trim())
    .in("bay_id", ids);
  if (error && !/supervisor_locked|column/i.test(error.message)) {
    throw new Error(error.message);
  }
}

export function summarizePublicationResult(input: {
  visibility: WeekPublicationVisibility;
  created_assignments: number;
  auto_publish_enabled: boolean;
}): string {
  const v = input.visibility;
  const cap =
    v.approved_capacity_total == null
      ? ""
      : ` against approved capacity ${v.approved_capacity_total}`;
  const parts = [
    `Assigned ${v.assigned_total}/${v.staged_total}${cap}`,
    v.unfilled_total > 0 ? `unfilled ${v.unfilled_total}` : null,
    v.supervisor_edited_total > 0
      ? `supervisor-edited ${v.supervisor_edited_total}`
      : null,
    v.supervisor_held_clear_total > 0
      ? `supervisor-held-clear ${v.supervisor_held_clear_total}`
      : null,
    v.zebra_handoff_required_total > 0
      ? `Zebra handoff still required ${v.zebra_handoff_required_total}`
      : null,
    `wrote ${input.created_assignments}`,
    input.auto_publish_enabled ? "auto-publish ON" : "auto-publish OFF",
  ].filter(Boolean);
  return parts.join("; ");
}

export { BASE_WEEKLY_BAY_QUOTA, composeWeekPublicationVisibility };
export type { PhysicalBaySelection, CapacityApprovalDraft, WeekPublicationVisibility };
