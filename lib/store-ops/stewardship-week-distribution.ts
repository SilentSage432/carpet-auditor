/**
 * DEPTSYNC-SECTION-ROTATION-006 — stewardship-aware weekly bay distribution.
 *
 * Pure planner: priority tiers → within-tier steward capacity fill →
 * aisle-diverse coverage fill → soft-preference assign with explanations.
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
  planSectionAwareFlatAssignments,
  sectionAwarePhysicalKey,
  type SectionAwareBayCandidate,
  type SectionAwareBayRef,
  type SectionAwarePreferenceKind,
  type SectionAwarePriorityTier,
  type SectionAwarePreviewItem,
  type SectionAwareWeeklyPreview,
} from "./section-aware-rotation";
import type { BaySectionLookup } from "./operational-sections";
import type { StoreWeekCapacitySnapshot } from "./shared-week-capacity";
import {
  BASE_WEEKLY_BAY_QUOTA,
  type ShiftRosterMember,
} from "./weekly-rotations";

export { SECTION_AWARE_ROTATION_AUTO_STAGE, BASE_WEEKLY_BAY_QUOTA };

/** ROTATION-006 activation: proposal composer only — auto-stage stays hard off. */
export const STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE = false as const;

export type SelectionExplanationCode =
  | "priority_tier"
  | "steward_section_fill"
  | "aisle_diversity"
  | "section_coverage"
  | "coverage_fallback"
  | "capacity_remaining"
  | "existing_assignment_skip";

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

export type StewardshipWeeklyProposal = Omit<
  SectionAwareWeeklyPreview,
  "items"
> & {
  actionable: boolean;
  block_reason: string | null;
  items: StewardshipProposalItem[];
  aisle_counts: Record<string, number>;
  distribution_note: string;
};

function aisleSortKey(aisle: string): string {
  const a = normalizeAisle(aisle);
  if (/^\d+$/.test(a)) {
    return `0:${a.padStart(6, "0")}`;
  }
  return `1:${a}`;
}

function compareCandidates(
  a: SectionAwareBayCandidate,
  b: SectionAwareBayCandidate
): number {
  const aisleCmp = aisleSortKey(String(a.aisle)).localeCompare(
    aisleSortKey(String(b.aisle))
  );
  if (aisleCmp !== 0) return aisleCmp;
  const bayCmp = Number(a.bay) - Number(b.bay);
  if (bayCmp !== 0) return bayCmp;
  return sectionAwarePhysicalKey(a).localeCompare(sectionAwarePhysicalKey(b));
}

function countSelectedByAisle(
  selected: readonly SectionAwareBayCandidate[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const bay of selected) {
    const aisle = normalizeAisle(bay.aisle);
    map.set(aisle, (map.get(aisle) ?? 0) + 1);
  }
  return map;
}

/**
 * Within-tier, capacity-aware candidate draw that avoids single-aisle collapse.
 *
 * Root cause addressed: prior rankBaysWithinPriorityTier + take-first-N used
 * lexicographic physical keys, so one aisle absorbed the entire shared draw
 * before assign-time steward preference could act.
 *
 * Phase A: round-robin stewards with remaining capacity, picking their
 * stewarded bays (stable aisle/bay order).
 * Phase B: aisle-diverse coverage among remaining equivalent-tier candidates.
 * Never leapfrogs priority tiers.
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
  const need = Math.max(0, Math.floor(drawCount));
  if (need === 0) return [];

  const slots = new Map<string, number>();
  const entries =
    remainingCaps instanceof Map
      ? remainingCaps.entries()
      : Object.entries(remainingCaps);
  for (const [id, n] of entries) {
    const sid = String(id).trim();
    const cap = Math.max(0, Math.floor(Number(n) || 0));
    if (sid && cap > 0) slots.set(sid, cap);
  }

  const selected: SectionAwareBayCandidate[] = [];
  const seen = new Set<string>();

  const take = (bay: SectionAwareBayCandidate): boolean => {
    const key = sectionAwarePhysicalKey(bay);
    if (seen.has(key)) return false;
    seen.add(key);
    selected.push(bay);
    return true;
  };

  for (const tierName of SECTION_AWARE_TIER_ORDER) {
    if (selected.length >= need) break;
    const bucket = tiers.find((t) => t.tier === tierName);
    if (!bucket || bucket.candidates.length === 0) continue;

    const pool = [...bucket.candidates]
      .filter((b) => !seen.has(sectionAwarePhysicalKey(b)))
      .sort(compareCandidates);

    // Phase A — steward capacity fill (round-robin by specialist id).
    let stewardProgress = true;
    while (selected.length < need && stewardProgress) {
      stewardProgress = false;
      const stewards = [...slots.keys()].sort((a, b) => a.localeCompare(b));
      for (const sid of stewards) {
        if (selected.length >= need) break;
        if ((slots.get(sid) ?? 0) <= 0) continue;
        const idx = pool.findIndex((bay) => {
          const key = sectionAwarePhysicalKey(bay);
          if (seen.has(key)) return false;
          const section = lookupBaySection(bay, baySectionByKey);
          return (
            String(section?.primary_owner_specialist_id ?? "").trim() === sid
          );
        });
        if (idx < 0) continue;
        const bay = pool[idx]!;
        if (take(bay)) {
          slots.set(sid, (slots.get(sid) ?? 0) - 1);
          stewardProgress = true;
        }
      }
    }

    // Phase B — aisle-diverse coverage among remaining tier candidates.
    while (selected.length < need) {
      const aisleCounts = countSelectedByAisle(selected);
      let best: SectionAwareBayCandidate | null = null;
      let bestScore = "";
      for (const bay of pool) {
        const key = sectionAwarePhysicalKey(bay);
        if (seen.has(key)) continue;
        const aisle = normalizeAisle(bay.aisle);
        const count = aisleCounts.get(aisle) ?? 0;
        const score = `${String(count).padStart(4, "0")}|${aisleSortKey(
          aisle
        )}|${String(bay.bay).padStart(6, "0")}|${key}`;
        if (!best || score.localeCompare(bestScore) < 0) {
          best = bay;
          bestScore = score;
        }
      }
      if (!best) break;
      take(best);
    }
  }

  return selected.slice(0, need);
}

function buildExplanation(input: {
  tier: SectionAwarePriorityTier | null;
  preference: SectionAwarePreferenceKind;
  aisle: string;
  remainingAfter: number;
  aisleAlreadyAssigned: number;
  usedDiversityPass: boolean;
}): SelectionExplanation {
  const codes: SelectionExplanationCode[] = [];
  if (input.tier) codes.push("priority_tier");
  if (input.preference === "steward_match") codes.push("steward_section_fill");
  else if (input.preference === "section_coverage") codes.push("section_coverage");
  else codes.push("coverage_fallback");
  if (input.usedDiversityPass || input.aisleAlreadyAssigned > 0) {
    codes.push("aisle_diversity");
  }
  codes.push("capacity_remaining");

  const tierLabel = input.tier ?? "unspecified";
  const prefLabel =
    input.preference === "steward_match"
      ? "steward section match"
      : input.preference === "section_coverage"
        ? "section coverage (soft)"
        : "coverage fallback";
  const diversity =
    input.usedDiversityPass || input.aisleAlreadyAssigned > 0
      ? ` Aisle ${normalizeAisle(input.aisle)} chosen with distribution among equal-priority candidates.`
      : "";
  const summary = `${tierLabel} priority · ${prefLabel}.${diversity} Remaining capacity after this pick: ${input.remainingAfter}.`;

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
 * Compose an actionable stewardship weekly proposal from known candidates.
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

  const drawCount = Math.min(
    input.capacity.remaining_shared,
    [...remainingCaps.values()].reduce((a, b) => a + b, 0),
    input.bays.filter((b) => !owned.has(String(b.rotationId))).length ||
      input.tiers.reduce((n, t) => n + t.candidates.length, 0)
  );

  if (!approvalGate.ok) {
    return emptyBlockedProposal(input, approvalGate.error, remainingCaps);
  }

  const distributed = selectBaysWithStewardshipDistribution(
    input.tiers,
    drawCount,
    input.baySectionByKey,
    remainingCaps
  );

  // Map distributed physical keys back to staged bay refs when available.
  const unownedRefs = input.bays.filter((b) => !owned.has(String(b.rotationId)));
  const refByKey = new Map(
    unownedRefs.map((b) => [sectionAwarePhysicalKey(b), b] as const)
  );
  const assignBays: SectionAwareBayRef[] = [];
  for (const cand of distributed) {
    const key = sectionAwarePhysicalKey(cand);
    const ref = refByKey.get(key);
    if (ref) {
      assignBays.push({
        ...ref,
        priority_tier: candTier(input.tiers, cand),
      });
    } else if (cand.rotationId) {
      assignBays.push({
        rotationId: cand.rotationId,
        department_id: cand.department_id,
        aisle: String(cand.aisle),
        bay: Number(cand.bay),
        riskScore: cand.riskScore ?? 0,
        priority_tier: candTier(input.tiers, cand),
      });
    }
  }

  // If staged refs exist but distribution used topology-only keys, fall back to
  // distributing among unowned staged refs with synthetic single aging tier.
  const planBays =
    assignBays.length > 0
      ? assignBays
      : selectBaysWithStewardshipDistribution(
          [
            {
              tier: "aging",
              candidates: unownedRefs.map((b) => ({
                department_id: b.department_id,
                aisle: String(b.aisle),
                bay: Number(b.bay),
                rotationId: b.rotationId,
                riskScore: b.riskScore,
              })),
            },
          ],
          drawCount,
          input.baySectionByKey,
          remainingCaps
        ).map((cand) => {
          const ref = refByKey.get(sectionAwarePhysicalKey(cand));
          return (
            ref ?? {
              rotationId: String(cand.rotationId ?? sectionAwarePhysicalKey(cand)),
              department_id: cand.department_id,
              aisle: String(cand.aisle),
              bay: Number(cand.bay),
              riskScore: cand.riskScore ?? 0,
              priority_tier: "aging" as const,
            }
          );
        });

  const plan = planSectionAwareFlatAssignments(
    planBays,
    input.members,
    remainingCaps,
    input.baySectionByKey,
    { knownHoursOnly: input.knownHoursOnly !== false }
  );

  const aisleAssignCounts = new Map<string, number>();
  const remainingAfter = new Map(remainingCaps);
  const sectionKeys = [...input.baySectionByKey.keys()].sort();

  const items: StewardshipProposalItem[] = plan.items.map((row) => {
    const bay = planBays.find((b) => b.rotationId === row.rotationId);
    const department_id = String(bay?.department_id ?? "").trim();
    const section = bay
      ? lookupBaySection(bay, input.baySectionByKey)
      : null;
    const preference =
      plan.preference_by_rotation[row.rotationId] ?? "coverage_fallback";
    const aisle = normalizeAisle(row.aisle);
    const priorAisle = aisleAssignCounts.get(aisle) ?? 0;
    aisleAssignCounts.set(aisle, priorAisle + 1);
    const left = Math.max(
      0,
      (remainingAfter.get(row.specialist_id) ?? 0) - 1
    );
    remainingAfter.set(row.specialist_id, left);
    const tier = bay?.priority_tier ?? null;
    const explanation = buildExplanation({
      tier,
      preference,
      aisle,
      remainingAfter: left,
      aisleAlreadyAssigned: priorAisle,
      usedDiversityPass: preference !== "steward_match",
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
  });

  const aisle_counts: Record<string, number> = {};
  for (const [aisle, n] of aisleAssignCounts) aisle_counts[aisle] = n;

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
      "PROPOSED only among known staged/candidate bays. Zero-bay named locations are not invented.",
    section_membership_count: sectionKeys.length,
    steward_match_count: items.filter((i) => i.preference === "steward_match")
      .length,
    coverage_fallback_count: items.filter(
      (i) => i.preference === "coverage_fallback"
    ).length,
    aisle_counts,
    distribution_note:
      "Within each priority tier, stewarded bays are filled round-robin by approved remaining capacity, then equal-priority coverage diversifies across aisles.",
  };
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
    capacity: Pick<
      StoreWeekCapacitySnapshot,
      | "shared_target"
      | "owned_total"
      | "remaining_shared"
      | "remaining_by_specialist"
      | "eligible_specialist_ids"
    >;
    baySectionByKey: ReadonlyMap<string, BaySectionLookup>;
  },
  reason: string,
  remainingCaps: Map<string, number>
): StewardshipWeeklyProposal {
  const sectionKeys = [...input.baySectionByKey.keys()].sort();
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
    topology_note: "No actionable proposal until weekly capacity is approved.",
    section_membership_count: sectionKeys.length,
    steward_match_count: 0,
    coverage_fallback_count: 0,
    aisle_counts: {},
    distribution_note: reason,
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
      "Stewardship proposal is outdated (capacity, assignments, sections, or candidates changed). Refresh before confirming.",
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
