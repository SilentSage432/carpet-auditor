/**
 * DEPTSYNC-OPERATIONAL-011 — strict section-owned weekly bay distribution.
 *
 * Pure planner: priority tiers → per-associate selection inside owned
 * Operational Sections → aisle diversity within section → explanations.
 *
 * Operational Sections are authoritative ownership boundaries.
 * Rotation assignments never create, transfer, or limit section ownership,
 * and never auto-assign a bay outside the associate's section.
 *
 * Does not persist, invent topology, activate Sunday auto-stage, or invent
 * capacity approvals. Consumes ROTATION-005 remaining capacity contract.
 */

import { normalizeAisle } from "./aisle";
import {
  assertApprovalsReadyForAssignment,
} from "./approved-week-capacity";
import {
  SECTION_AWARE_ROTATION_AUTO_STAGE,
  SECTION_AWARE_TIER_ORDER,
  buildSectionAwarePreviewFingerprint,
  lookupBaySection,
  sectionAwarePhysicalKey,
  type SectionAwareBayCandidate,
  type SectionAwareBayRef,
  type SectionAwarePreferenceKind,
  type SectionAwarePriorityTier,
  type SectionAwarePreviewItem,
  type SectionAwareWeeklyPreview,
} from "./section-aware-rotation";
import {
  STRICT_SECTION_OWNERSHIP_AUTO_STAGE,
  buildSectionOwnershipDigest,
  explainUnfilledCapacity,
  indexOwnedBaysBySpecialist,
  inspectSectionOwnershipEvidence,
  planStrictSectionOwnershipAssignments,
  selectBaysWithStrictSectionOwnership,
  type UnfilledCapacityReason,
} from "./section-ownership-enforcement";
import type { BaySectionLookup } from "./operational-sections";
import type { StoreWeekCapacitySnapshot } from "./shared-week-capacity";
import {
  BASE_WEEKLY_BAY_QUOTA,
  type ShiftRosterMember,
} from "./weekly-rotations";

export { SECTION_AWARE_ROTATION_AUTO_STAGE, BASE_WEEKLY_BAY_QUOTA };
export { STRICT_SECTION_OWNERSHIP_AUTO_STAGE };

/** Proposal composer only — auto-stage stays hard off. */
export const STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE = false as const;

export type SelectionExplanationCode =
  | "priority_tier"
  | "steward_section_fill"
  | "aisle_diversity"
  | "section_ownership"
  | "capacity_remaining"
  | "existing_assignment_skip"
  | "unfilled_capacity";

export type SelectionExplanation = {
  codes: SelectionExplanationCode[];
  /** Deterministic human-readable summary from evidence only. */
  summary: string;
  priority_tier: SectionAwarePriorityTier | null;
  preference: SectionAwarePreferenceKind;
  aisle: string;
  steward_match: boolean;
};

export type StewardshipProposalItem = SectionAwarePreviewItem & {
  explanation: SelectionExplanation;
};

export type StewardshipAssociateSummary = {
  specialist_id: string;
  specialist_name: string;
  section_id: string | null;
  section_name: string | null;
  approved_capacity: number;
  proposed_count: number;
  aisles: string[];
  unfilled: number;
  unfilled_reason: string | null;
};

export type StewardshipWeeklyProposal = Omit<
  SectionAwareWeeklyPreview,
  "items"
> & {
  actionable: boolean;
  block_reason: string | null;
  items: StewardshipProposalItem[];
  aisle_counts: Record<string, number>;
  distribution_note: string;
  ownership_digest: string;
  associate_summaries: StewardshipAssociateSummary[];
  unfilled_capacity: UnfilledCapacityReason[];
};

/**
 * Within-tier strict ownership draw.
 * Prefer selectBaysWithStrictSectionOwnership for associate-first capacity.
 * Kept as a thin wrapper for existing call sites / tests.
 */
export function selectBaysWithStewardshipDistribution(
  tiers: ReadonlyArray<{
    tier: SectionAwarePriorityTier;
    candidates: readonly SectionAwareBayCandidate[];
  }>,
  drawCount: number,
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>,
  remainingCaps: ReadonlyMap<string, number> | Record<string, number>
): SectionAwareBayCandidate[] {
  const evidence = inspectSectionOwnershipEvidence(baySectionByKey, {
    requireMembershipEvidence: true,
  });
  if (!evidence.ok) return [];

  const { selected } = selectBaysWithStrictSectionOwnership(
    tiers,
    remainingCaps,
    baySectionByKey
  );
  const need = Math.max(0, Math.floor(drawCount));
  return selected.slice(0, need);
}

function buildExplanation(input: {
  tier: SectionAwarePriorityTier | null;
  preference: SectionAwarePreferenceKind;
  aisle: string;
  remainingAfter: number;
  aisleAlreadyAssigned: number;
  sectionName: string | null;
}): SelectionExplanation {
  const codes: SelectionExplanationCode[] = [];
  if (input.tier) codes.push("priority_tier");
  codes.push("section_ownership");
  if (input.preference === "steward_match") codes.push("steward_section_fill");
  if (input.aisleAlreadyAssigned > 0) codes.push("aisle_diversity");
  codes.push("capacity_remaining");

  const tierLabel = input.tier ?? "unspecified";
  const sectionLabel = input.sectionName
    ? `owned section ${input.sectionName}`
    : "owned Operational Section";
  const diversity =
    input.aisleAlreadyAssigned > 0
      ? ` Aisle ${normalizeAisle(input.aisle)} chosen with within-section distribution.`
      : "";
  const summary = `${tierLabel} priority · ${sectionLabel}.${diversity} Remaining capacity after this pick: ${input.remainingAfter}.`;

  return {
    codes,
    summary: summary.trim(),
    priority_tier: input.tier,
    preference: input.preference,
    aisle: normalizeAisle(input.aisle),
    steward_match: input.preference === "steward_match",
  };
}

/**
 * Compose an actionable strict-ownership weekly proposal from known candidates.
 * Requires approvals_complete on the capacity snapshot.
 */
export function composeStewardshipWeeklyProposal(input: {
  store_number: string;
  week_label: string;
  /** Tiered candidate inventory (never invents bays). */
  tiers: ReadonlyArray<{
    tier: SectionAwarePriorityTier;
    candidates: readonly SectionAwareBayCandidate[];
  }>;
  /** Staged / known bay refs for assign (rotation ids). */
  bays: SectionAwareBayRef[];
  members: ShiftRosterMember[];
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>;
  /** Physical keys with multi-section claims (fail closed). */
  conflictPhysicalKeys?: readonly string[];
  ownedRotationIds?: ReadonlySet<string> | readonly string[];
  capacity: Pick<
    StoreWeekCapacitySnapshot,
    | "shared_target"
    | "owned_total"
    | "remaining_shared"
    | "remaining_by_specialist"
    | "eligible_specialist_ids"
    | "approvals_complete"
    | "approved_by_specialist"
  >;
  knownHoursOnly?: boolean;
}): StewardshipWeeklyProposal {
  const ownershipDigest = buildSectionOwnershipDigest(input.baySectionByKey);
  const ownershipBySpecialist = indexOwnedBaysBySpecialist(
    input.baySectionByKey
  );

  const approvalGate = assertApprovalsReadyForAssignment({
    approvals_complete: input.capacity.approvals_complete,
    approved_by_specialist: input.capacity.approved_by_specialist,
    eligible_count: input.capacity.eligible_specialist_ids.length,
    shared_target: input.capacity.shared_target,
  });

  const owned = new Set(
    [...(input.ownedRotationIds ?? [])]
      .map((id) => String(id).trim())
      .filter(Boolean)
  );

  const remainingCaps = new Map<string, number>();
  for (const [id, n] of Object.entries(
    input.capacity.remaining_by_specialist ?? {}
  )) {
    remainingCaps.set(String(id), Math.max(0, Math.floor(n)));
  }
  for (const id of input.capacity.eligible_specialist_ids ?? []) {
    if (!remainingCaps.has(id)) remainingCaps.set(id, 0);
  }

  if (!approvalGate.ok) {
    return emptyBlockedProposal(
      input,
      approvalGate.error,
      remainingCaps,
      ownershipDigest,
      ownershipBySpecialist
    );
  }

  const evidence = inspectSectionOwnershipEvidence(input.baySectionByKey, {
    requireMembershipEvidence: true,
    eligibleSpecialistIds: input.capacity.eligible_specialist_ids,
    conflictPhysicalKeys: input.conflictPhysicalKeys,
  });
  if (!evidence.ok) {
    return emptyBlockedProposal(
      input,
      evidence.issue.message,
      remainingCaps,
      ownershipDigest,
      ownershipBySpecialist
    );
  }

  const unownedRefs = input.bays.filter((b) => !owned.has(String(b.rotationId)));
  const refByKey = new Map(
    unownedRefs.map((b) => [sectionAwarePhysicalKey(b), b] as const)
  );

  // Prefer staged refs as the candidate pool; fall back to tier candidates.
  const tierSource =
    unownedRefs.length > 0
      ? classifyBayPriorityTier(unownedRefs)
      : input.tiers.map((bucket) => ({
          tier: bucket.tier,
          candidates: bucket.candidates.filter(
            (c) => !owned.has(String(c.rotationId ?? ""))
          ),
        }));

  const { selected } = selectBaysWithStrictSectionOwnership(
    tierSource,
    remainingCaps,
    input.baySectionByKey
  );

  const planBays: SectionAwareBayRef[] = [];
  for (const cand of selected) {
    const key = sectionAwarePhysicalKey(cand);
    const ref = refByKey.get(key);
    if (ref) {
      planBays.push({
        ...ref,
        priority_tier: candTier(tierSource, cand),
      });
    } else if (cand.rotationId) {
      planBays.push({
        rotationId: cand.rotationId,
        department_id: cand.department_id,
        aisle: String(cand.aisle),
        bay: Number(cand.bay),
        riskScore: cand.riskScore ?? 0,
        priority_tier: candTier(tierSource, cand),
      });
    }
  }

  const plan = planStrictSectionOwnershipAssignments(
    planBays,
    input.members,
    remainingCaps,
    input.baySectionByKey,
    { knownHoursOnly: input.knownHoursOnly !== false }
  );

  const aisleAssignCounts = new Map<string, number>();
  const remainingAfter = new Map(remainingCaps);
  const sectionKeys = [...input.baySectionByKey.keys()].sort();
  const proposedBySpecialist: Record<string, number> = {};

  const items: StewardshipProposalItem[] = plan.items.map((row) => {
    const bay = planBays.find((b) => b.rotationId === row.rotationId);
    const department_id = String(bay?.department_id ?? "").trim();
    const section = bay
      ? lookupBaySection(bay, input.baySectionByKey)
      : null;
    const preference: SectionAwarePreferenceKind = "steward_match";
    const aisle = normalizeAisle(row.aisle);
    const priorAisle = aisleAssignCounts.get(aisle) ?? 0;
    aisleAssignCounts.set(aisle, priorAisle + 1);
    const left = Math.max(
      0,
      (remainingAfter.get(row.specialist_id) ?? 0) - 1
    );
    remainingAfter.set(row.specialist_id, left);
    proposedBySpecialist[row.specialist_id] =
      (proposedBySpecialist[row.specialist_id] ?? 0) + 1;
    const tier = bay?.priority_tier ?? null;
    const explanation = buildExplanation({
      tier,
      preference,
      aisle,
      remainingAfter: left,
      aisleAlreadyAssigned: priorAisle,
      sectionName: section?.section_name ?? null,
    });

    return {
      ...row,
      state: "PROPOSED",
      department_id,
      physical_key: bay
        ? sectionAwarePhysicalKey(bay)
        : `${department_id}|${aisle}|${row.bay}`,
      section_id: section?.section_id ?? null,
      section_name: section?.section_name ?? null,
      steward_specialist_id: section?.primary_owner_specialist_id ?? null,
      steward_name: section?.primary_owner_name ?? null,
      preference,
      priority_tier: tier,
      explanation,
    };
  });

  const fingerprint = buildSectionAwarePreviewFingerprint({
    store_number: input.store_number,
    week_label: input.week_label,
    rotation_ids: items.map((i) => i.rotationId),
    assignee_ids: items.map((i) => i.specialist_id),
    section_member_keys: sectionKeys,
    owned_total: input.capacity.owned_total,
    remaining_shared: input.capacity.remaining_shared,
    eligible_ids: input.capacity.eligible_specialist_ids,
    ownership_digest: ownershipDigest,
  });

  const aisle_counts: Record<string, number> = {};
  for (const [aisle, n] of aisleAssignCounts) aisle_counts[aisle] = n;

  const unfilled_capacity = explainUnfilledCapacity({
    members: input.members.filter((m) => m.active),
    remainingBefore: remainingCaps,
    proposedBySpecialist,
    approvedBySpecialist: input.capacity.approved_by_specialist,
    ownershipBySpecialist,
  });

  const associate_summaries = buildAssociateSummaries({
    members: input.members,
    items,
    remainingCaps,
    approvedBySpecialist: input.capacity.approved_by_specialist,
    ownershipBySpecialist,
    unfilled_capacity,
  });

  return {
    state: "PROPOSED",
    week_label: input.week_label,
    store_number: input.store_number,
    fingerprint,
    actionable: true,
    block_reason: null,
    items,
    loads: plan.loads,
    total_hours: plan.total_hours,
    shared_target: input.capacity.shared_target,
    owned_total: input.capacity.owned_total,
    remaining_shared: Math.max(
      0,
      input.capacity.remaining_shared - items.length
    ),
    remaining_by_specialist: Object.fromEntries(remainingAfter),
    topology_note:
      "PROPOSED only among known staged/candidate bays inside each associate's Operational Section. Zero-bay named locations are not invented.",
    section_membership_count: sectionKeys.length,
    steward_match_count: items.length,
    coverage_fallback_count: 0,
    aisle_counts,
    distribution_note:
      "Each associate receives only bays inside their owned Operational Section, up to approved remaining capacity, with priority tiers and within-section aisle diversity. Unused capacity is never filled from another associate's section.",
    ownership_digest: ownershipDigest,
    associate_summaries,
    unfilled_capacity,
  };
}

function buildAssociateSummaries(input: {
  members: ShiftRosterMember[];
  items: StewardshipProposalItem[];
  remainingCaps: Map<string, number>;
  approvedBySpecialist?: Readonly<Record<string, number>>;
  ownershipBySpecialist: ReturnType<typeof indexOwnedBaysBySpecialist>;
  unfilled_capacity: UnfilledCapacityReason[];
}): StewardshipAssociateSummary[] {
  const unfilledById = new Map(
    input.unfilled_capacity.map((row) => [row.specialist_id, row] as const)
  );
  return input.members
    .filter((m) => m.active)
    .slice()
    .sort((a, b) => a.specialist_id.localeCompare(b.specialist_id))
    .map((member) => {
      const mine = input.items.filter(
        (i) => i.specialist_id === member.specialist_id
      );
      const owned = input.ownershipBySpecialist.get(member.specialist_id);
      const remaining = Math.max(
        0,
        Math.floor(input.remainingCaps.get(member.specialist_id) ?? 0)
      );
      const approved = Math.max(
        0,
        Math.floor(
          input.approvedBySpecialist?.[member.specialist_id] ?? remaining
        )
      );
      const unfilled = unfilledById.get(member.specialist_id);
      const aisles = [
        ...new Set(mine.map((i) => normalizeAisle(i.aisle)).filter(Boolean)),
      ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return {
        specialist_id: member.specialist_id,
        specialist_name: member.specialist_name,
        section_id: owned?.section_ids[0] ?? null,
        section_name: owned?.section_names[0] ?? null,
        approved_capacity: approved,
        proposed_count: mine.length,
        aisles,
        unfilled: unfilled?.unfilled ?? Math.max(0, remaining - mine.length),
        unfilled_reason: unfilled?.reason ?? null,
      };
    });
}

function candTier(
  tiers: ReadonlyArray<{
    tier: SectionAwarePriorityTier;
    candidates: readonly SectionAwareBayCandidate[];
  }>,
  cand: SectionAwareBayCandidate
): SectionAwarePriorityTier | null {
  const key = sectionAwarePhysicalKey(cand);
  for (const bucket of tiers) {
    if (
      bucket.candidates.some((c) => sectionAwarePhysicalKey(c) === key)
    ) {
      return bucket.tier;
    }
  }
  return null;
}

function emptyBlockedProposal(
  input: {
    store_number: string;
    week_label: string;
    members?: ShiftRosterMember[];
    capacity: Pick<
      StoreWeekCapacitySnapshot,
      | "shared_target"
      | "owned_total"
      | "remaining_shared"
      | "remaining_by_specialist"
      | "eligible_specialist_ids"
      | "approved_by_specialist"
    >;
    baySectionByKey: ReadonlyMap<string, BaySectionLookup>;
  },
  reason: string,
  remainingCaps: Map<string, number>,
  ownershipDigest: string,
  ownershipBySpecialist: ReturnType<typeof indexOwnedBaysBySpecialist>
): StewardshipWeeklyProposal {
  const sectionKeys = [...input.baySectionByKey.keys()].sort();
  const members = (input.members ?? []).filter((m) => m.active);
  const unfilled_capacity = explainUnfilledCapacity({
    members,
    remainingBefore: remainingCaps,
    proposedBySpecialist: {},
    approvedBySpecialist: input.capacity.approved_by_specialist,
    ownershipBySpecialist,
    blocked: true,
  });
  return {
    state: "PROPOSED",
    week_label: input.week_label,
    store_number: input.store_number,
    fingerprint: buildSectionAwarePreviewFingerprint({
      store_number: input.store_number,
      week_label: input.week_label,
      rotation_ids: [],
      assignee_ids: [],
      section_member_keys: sectionKeys,
      owned_total: input.capacity.owned_total,
      remaining_shared: input.capacity.remaining_shared,
      eligible_ids: input.capacity.eligible_specialist_ids,
      ownership_digest: ownershipDigest,
    }),
    actionable: false,
    block_reason: reason,
    items: [],
    loads: [],
    total_hours: 0,
    shared_target: input.capacity.shared_target,
    owned_total: input.capacity.owned_total,
    remaining_shared: input.capacity.remaining_shared,
    remaining_by_specialist: Object.fromEntries(remainingCaps),
    topology_note: "No actionable proposal until ownership and capacity are valid.",
    section_membership_count: sectionKeys.length,
    steward_match_count: 0,
    coverage_fallback_count: 0,
    aisle_counts: {},
    distribution_note: reason,
    ownership_digest: ownershipDigest,
    associate_summaries: buildAssociateSummaries({
      members,
      items: [],
      remainingCaps,
      approvedBySpecialist: input.capacity.approved_by_specialist,
      ownershipBySpecialist,
      unfilled_capacity,
    }),
    unfilled_capacity,
  };
}

export function assertStewardshipProposalFresh(
  expectedFingerprint: string,
  recomputed: StewardshipWeeklyProposal
): { ok: true } | { ok: false; code: "STALE_PREVIEW"; message: string } {
  if (
    String(expectedFingerprint ?? "").trim() &&
    expectedFingerprint === recomputed.fingerprint &&
    recomputed.actionable
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "STALE_PREVIEW",
    message:
      "Section ownership proposal is outdated (capacity, assignments, sections, or ownership changed). Regenerate before confirming.",
  };
}

/** Classify staged/candidate bays into a single tier bucket for proposal draw. */
export function classifyBayPriorityTier(
  bays: ReadonlyArray<
    SectionAwareBayRef & {
      carried_over?: boolean | null;
      seasonal_high?: boolean | null;
      priority_override?: boolean | null;
      velocity_hot?: boolean | null;
    }
  >
): Array<{
  tier: SectionAwarePriorityTier;
  candidates: SectionAwareBayCandidate[];
}> {
  const buckets: Record<SectionAwarePriorityTier, SectionAwareBayCandidate[]> =
    {
      carry: [],
      seasonal: [],
      high: [],
      velocity: [],
      aging: [],
    };
  for (const bay of bays) {
    const cand: SectionAwareBayCandidate = {
      department_id: bay.department_id,
      aisle: String(bay.aisle),
      bay: Number(bay.bay),
      rotationId: bay.rotationId,
      riskScore: bay.riskScore,
    };
    if (bay.priority_tier && SECTION_AWARE_TIER_ORDER.includes(bay.priority_tier)) {
      buckets[bay.priority_tier].push(cand);
      continue;
    }
    if (bay.carried_over) buckets.carry.push(cand);
    else if (bay.seasonal_high) buckets.seasonal.push(cand);
    else if (bay.priority_override) buckets.high.push(cand);
    else if (bay.velocity_hot) buckets.velocity.push(cand);
    else buckets.aging.push(cand);
  }
  return SECTION_AWARE_TIER_ORDER.map((tier) => ({
    tier,
    candidates: buckets[tier],
  }));
}
