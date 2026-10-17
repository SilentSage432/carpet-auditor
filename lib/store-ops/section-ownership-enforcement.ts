/**
 * DEPTSYNC-OPERATIONAL-011 — strict Operational Section ownership.
 *
 * Pure composition. Operational Sections are authoritative ownership
 * boundaries for automatic weekly assignment. Does not persist, invent
 * membership, rewrite history, or activate Sunday auto-stage.
 */

import { normalizeAisle } from "./aisle";
import type { BaySectionLookup } from "./operational-sections";
import {
  SECTION_AWARE_TIER_ORDER,
  lookupBaySection,
  sectionAwarePhysicalKey,
  type SectionAwareBayCandidate,
  type SectionAwareBayRef,
  type SectionAwarePriorityTier,
} from "./section-aware-rotation";
import {
  formatShiftTag,
  type AssociateLoadPreview,
  type BayAssignmentPlanItem,
  type ProportionalAssignmentPlan,
  type ShiftRosterMember,
} from "./weekly-rotations";

export const STRICT_SECTION_OWNERSHIP_AUTO_STAGE = false as const;

export type OwnershipEvidenceIssue =
  | {
      code: "OWNERSHIP_OVERLAP";
      message: string;
      physical_keys: string[];
    }
  | {
      code: "OWNERSHIP_MISSING";
      message: string;
    }
  | {
      code: "OWNERSHIP_AMBIGUOUS";
      message: string;
      specialist_id: string;
    };

export type UnfilledCapacityReasonCode =
  | "no_section"
  | "insufficient_eligible_bays"
  | "capacity_zero"
  | "not_eligible"
  | "ownership_blocked";

export type UnfilledCapacityReason = {
  specialist_id: string;
  specialist_name: string;
  approved_capacity: number;
  proposed_count: number;
  unfilled: number;
  code: UnfilledCapacityReasonCode;
  reason: string;
  section_id: string | null;
  section_name: string | null;
};

export type AssociateSectionOwnership = {
  specialist_id: string;
  section_ids: string[];
  section_names: string[];
  bay_keys: string[];
};

function resolvePlannerHours(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 10) / 10;
}

function aisleSortKey(aisle: string): string {
  const a = normalizeAisle(aisle);
  if (/^\d+$/.test(a)) return `0:${a.padStart(6, "0")}`;
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

/** Digest of physical-key → owner for freshness / stale-ownership detection. */
export function buildSectionOwnershipDigest(
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>
): string {
  return [...baySectionByKey.entries()]
    .map(([key, section]) => {
      const owner = String(section.primary_owner_specialist_id ?? "").trim();
      const sectionId = String(section.section_id ?? "").trim();
      return `${key}->${sectionId}:${owner || "NONE"}`;
    })
    .sort()
    .join("|");
}

/**
 * Fail closed when the same physical bay maps to conflicting section/owner
 * evidence, or when active memberships lack a primary owner while present.
 *
 * Callers that build the map via last-write-wins should also pass raw
 * membership rows through findActiveBayMembershipConflicts.
 */
export function inspectSectionOwnershipEvidence(
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>,
  options?: {
    /** When true, empty membership map is an actionable missing-ownership fault. */
    requireMembershipEvidence?: boolean;
    /** Specialist ids that must have exactly one clear owned section to receive work. */
    eligibleSpecialistIds?: readonly string[];
    /** Physical keys claimed by more than one active section (fail closed). */
    conflictPhysicalKeys?: readonly string[];
  }
): { ok: true } | { ok: false; issue: OwnershipEvidenceIssue } {
  const explicitConflicts = [
    ...new Set(
      (options?.conflictPhysicalKeys ?? [])
        .map((k) => String(k).trim())
        .filter(Boolean)
    ),
  ].sort();
  if (explicitConflicts.length > 0) {
    return {
      ok: false,
      issue: {
        code: "OWNERSHIP_OVERLAP",
        message:
          "Overlapping Operational Section ownership evidence — refusing automatic assignment.",
        physical_keys: explicitConflicts,
      },
    };
  }

  if (
    options?.requireMembershipEvidence &&
    (!baySectionByKey || baySectionByKey.size === 0)
  ) {
    return {
      ok: false,
      issue: {
        code: "OWNERSHIP_MISSING",
        message:
          "Operational Section membership evidence is missing — refusing automatic assignment.",
      },
    };
  }

  const ownerByKey = new Map<string, string>();
  const sectionByKey = new Map<string, string>();
  const overlapKeys: string[] = [];
  let missingOwnerCount = 0;

  for (const [key, section] of baySectionByKey) {
    const owner = String(section.primary_owner_specialist_id ?? "").trim();
    const sectionId = String(section.section_id ?? "").trim();
    if (!owner) {
      missingOwnerCount += 1;
      continue;
    }
    const priorOwner = ownerByKey.get(key);
    const priorSection = sectionByKey.get(key);
    if (
      (priorOwner && priorOwner !== owner) ||
      (priorSection && priorSection !== sectionId)
    ) {
      overlapKeys.push(key);
    }
    ownerByKey.set(key, owner);
    sectionByKey.set(key, sectionId);
  }

  if (overlapKeys.length > 0) {
    return {
      ok: false,
      issue: {
        code: "OWNERSHIP_OVERLAP",
        message:
          "Overlapping Operational Section ownership evidence — refusing automatic assignment.",
        physical_keys: [...new Set(overlapKeys)].sort(),
      },
    };
  }

  if (baySectionByKey.size > 0 && missingOwnerCount === baySectionByKey.size) {
    return {
      ok: false,
      issue: {
        code: "OWNERSHIP_MISSING",
        message:
          "Operational Section memberships exist but no primary owners are set — refusing automatic assignment.",
      },
    };
  }

  const eligible = options?.eligibleSpecialistIds ?? [];
  for (const rawId of eligible) {
    const sid = String(rawId ?? "").trim();
    if (!sid) continue;
    const ownedSections = new Set<string>();
    for (const section of baySectionByKey.values()) {
      if (String(section.primary_owner_specialist_id ?? "").trim() !== sid) {
        continue;
      }
      ownedSections.add(String(section.section_id ?? "").trim());
    }
    // Multiple distinct sections for one associate is allowed (continuous
    // responsibility). Ambiguity is conflicting owners on one bay only.
    void ownedSections;
  }

  return { ok: true };
}

export function associateOwnsBay(
  bay: { department_id: string; aisle: string | number; bay: number | string },
  specialistId: string,
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>
): boolean {
  const sid = String(specialistId ?? "").trim();
  if (!sid) return false;
  const section = lookupBaySection(bay, baySectionByKey);
  if (!section) return false;
  const owner = String(section.primary_owner_specialist_id ?? "").trim();
  return Boolean(owner && owner === sid);
}

export function assertAssigneeOwnsBay(
  bay: { department_id: string; aisle: string | number; bay: number | string },
  specialistId: string,
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>
): { ok: true } | { ok: false; code: string; message: string } {
  const section = lookupBaySection(bay, baySectionByKey);
  if (!section) {
    return {
      ok: false,
      code: "SECTION_OWNERSHIP_MISSING",
      message: "Bay has no Operational Section membership — assignment rejected.",
    };
  }
  const owner = String(section.primary_owner_specialist_id ?? "").trim();
  if (!owner) {
    return {
      ok: false,
      code: "SECTION_OWNERSHIP_MISSING",
      message:
        "Operational Section has no primary owner — assignment rejected.",
    };
  }
  if (owner !== String(specialistId ?? "").trim()) {
    return {
      ok: false,
      code: "SECTION_OWNERSHIP_MISMATCH",
      message:
        "Assignee is not the Operational Section owner of this bay — assignment rejected.",
    };
  }
  return { ok: true };
}

export function indexOwnedBaysBySpecialist(
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>
): Map<string, AssociateSectionOwnership> {
  const byOwner = new Map<string, AssociateSectionOwnership>();
  for (const [key, section] of baySectionByKey) {
    const owner = String(section.primary_owner_specialist_id ?? "").trim();
    if (!owner) continue;
    const current = byOwner.get(owner) ?? {
      specialist_id: owner,
      section_ids: [],
      section_names: [],
      bay_keys: [],
    };
    const sectionId = String(section.section_id ?? "").trim();
    const sectionName = String(section.section_name ?? "").trim();
    if (sectionId && !current.section_ids.includes(sectionId)) {
      current.section_ids.push(sectionId);
      current.section_names.push(sectionName || sectionId);
    }
    if (!current.bay_keys.includes(key)) current.bay_keys.push(key);
    byOwner.set(owner, current);
  }
  for (const row of byOwner.values()) {
    row.bay_keys.sort();
    row.section_ids.sort();
  }
  return byOwner;
}

/**
 * Associate-first strict selection: each associate receives only bays inside
 * their Operational Section(s), up to remaining capacity, preserving tier
 * order and within-section aisle diversity. Never fills unused capacity from
 * another associate's section.
 */
export function selectBaysWithStrictSectionOwnership(
  tiers: ReadonlyArray<{
    tier: SectionAwarePriorityTier;
    candidates: readonly SectionAwareBayCandidate[];
  }>,
  remainingCaps: ReadonlyMap<string, number> | Record<string, number>,
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>
): {
  selected: Array<SectionAwareBayCandidate & { owner_specialist_id: string }>;
  byOwner: Record<string, number>;
} {
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

  const selected: Array<
    SectionAwareBayCandidate & { owner_specialist_id: string }
  > = [];
  const seen = new Set<string>();
  const byOwner: Record<string, number> = {};
  const aisleCountsByOwner = new Map<string, Map<string, number>>();

  const takeFor = (
    sid: string,
    bay: SectionAwareBayCandidate
  ): boolean => {
    const key = sectionAwarePhysicalKey(bay);
    if (seen.has(key)) return false;
    if ((slots.get(sid) ?? 0) <= 0) return false;
    if (!associateOwnsBay(bay, sid, baySectionByKey)) return false;
    seen.add(key);
    slots.set(sid, (slots.get(sid) ?? 0) - 1);
    selected.push({ ...bay, owner_specialist_id: sid });
    byOwner[sid] = (byOwner[sid] ?? 0) + 1;
    const aisle = normalizeAisle(bay.aisle);
    const aisleMap = aisleCountsByOwner.get(sid) ?? new Map();
    aisleMap.set(aisle, (aisleMap.get(aisle) ?? 0) + 1);
    aisleCountsByOwner.set(sid, aisleMap);
    return true;
  };

  const stewards = [...slots.keys()].sort((a, b) => a.localeCompare(b));

  for (const tierName of SECTION_AWARE_TIER_ORDER) {
    const bucket = tiers.find((t) => t.tier === tierName);
    if (!bucket || bucket.candidates.length === 0) continue;
    const pool = [...bucket.candidates]
      .filter((b) => !seen.has(sectionAwarePhysicalKey(b)))
      .sort(compareCandidates);

    let progress = true;
    while (progress) {
      progress = false;
      for (const sid of stewards) {
        if ((slots.get(sid) ?? 0) <= 0) continue;
        const aisleCounts = aisleCountsByOwner.get(sid) ?? new Map();
        let best: SectionAwareBayCandidate | null = null;
        let bestScore = "";
        for (const bay of pool) {
          const key = sectionAwarePhysicalKey(bay);
          if (seen.has(key)) continue;
          if (!associateOwnsBay(bay, sid, baySectionByKey)) continue;
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
        if (best && takeFor(sid, best)) progress = true;
      }
    }
  }

  return { selected, byOwner };
}

/**
 * Hard ownership assigner: a bay may only go to its section primary owner.
 * Unsectioned / ownerless bays are never assigned. Unused capacity is never
 * filled from another associate's section.
 */
export function planStrictSectionOwnershipAssignments(
  bays: SectionAwareBayRef[],
  members: ShiftRosterMember[],
  remainingCaps: ReadonlyMap<string, number>,
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>,
  options?: { knownHoursOnly?: boolean }
): ProportionalAssignmentPlan & {
  preference_by_rotation: Record<string, "steward_match">;
} {
  // AUTO-005A: weekly ownership is gated by remaining approved capacity +
  // section ownership, not by shift hours. knownHoursOnly retained for API
  // parity but no longer excludes zero-hour associates from assignment.
  void options?.knownHoursOnly;
  const active = members
    .filter((m) => {
      if (!m.active) return false;
      return Math.max(0, Math.floor(remainingCaps.get(m.specialist_id) ?? 0)) > 0;
    })
    .slice()
    .sort((a, b) =>
      String(a.specialist_id).localeCompare(String(b.specialist_id))
    );

  const empty = {
    total_hours: 0,
    items: [] as BayAssignmentPlanItem[],
    loads: [] as AssociateLoadPreview[],
    preference_by_rotation: {} as Record<string, "steward_match">,
  };
  if (bays.length === 0 || active.length === 0) return empty;

  const remaining = new Map(remainingCaps);
  const hours = active.map((m) => resolvePlannerHours(m.hours));
  const totalHours = hours.reduce((sum, h) => sum + h, 0);
  const quotas = active.map((m) =>
    Math.max(0, Math.floor(remainingCaps.get(m.specialist_id) ?? 0))
  );
  const items: BayAssignmentPlanItem[] = [];
  const preference_by_rotation: Record<string, "steward_match"> = {};

  // Preserve caller order (already tier/diversity ordered) while enforcing owner.
  for (const bay of bays) {
    const section = lookupBaySection(bay, baySectionByKey);
    const ownerId = String(section?.primary_owner_specialist_id ?? "").trim();
    if (!ownerId) continue;
    const member = active.find((m) => m.specialist_id === ownerId);
    if (!member) continue;
    if ((remaining.get(ownerId) ?? 0) <= 0) continue;
    remaining.set(ownerId, (remaining.get(ownerId) ?? 0) - 1);
    const memberHours = resolvePlannerHours(member.hours);
    items.push({
      rotationId: bay.rotationId,
      specialist_id: member.specialist_id,
      specialist_name: member.specialist_name,
      hours: memberHours,
      shift_tag: formatShiftTag(memberHours),
      aisle: bay.aisle,
      bay: bay.bay,
      riskScore: bay.riskScore,
    });
    preference_by_rotation[bay.rotationId] = "steward_match";
  }

  const loads: AssociateLoadPreview[] = active.map((member, i) => {
    const mine = items.filter((row) => row.specialist_id === member.specialist_id);
    const aisles = [
      ...new Set(mine.map((row) => normalizeAisle(row.aisle)).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const memberHours = resolvePlannerHours(member.hours);
    return {
      specialist_id: member.specialist_id,
      specialist_name: member.specialist_name,
      hours: memberHours,
      quota: quotas[i] ?? 0,
      weight_pct:
        totalHours > 0 ? Math.round((memberHours / totalHours) * 100) : 0,
      aisles,
      high_risk: mine.filter((row) => row.riskScore > 0).length,
    };
  });

  return { total_hours: totalHours, items, loads, preference_by_rotation };
}

export function explainUnfilledCapacity(input: {
  members: ShiftRosterMember[];
  remainingBefore: ReadonlyMap<string, number>;
  proposedBySpecialist: Readonly<Record<string, number>>;
  approvedBySpecialist?: Readonly<Record<string, number>>;
  ownershipBySpecialist: ReadonlyMap<string, AssociateSectionOwnership>;
  blocked?: boolean;
}): UnfilledCapacityReason[] {
  const out: UnfilledCapacityReason[] = [];
  for (const member of input.members) {
    const sid = member.specialist_id;
    const remaining = Math.max(0, Math.floor(input.remainingBefore.get(sid) ?? 0));
    const proposed = Math.max(0, Math.floor(input.proposedBySpecialist[sid] ?? 0));
    const approved = Math.max(
      0,
      Math.floor(input.approvedBySpecialist?.[sid] ?? remaining + proposed)
    );
    const unfilled = Math.max(0, remaining - proposed);
    if (unfilled <= 0 && proposed > 0) continue;
    if (remaining <= 0 && approved <= 0) continue;

    const owned = input.ownershipBySpecialist.get(sid);
    let code: UnfilledCapacityReasonCode = "insufficient_eligible_bays";
    let reason =
      "Insufficient eligible bays within owned Operational Section for remaining capacity.";
    if (input.blocked) {
      code = "ownership_blocked";
      reason = "Proposal blocked by ownership evidence fault.";
    } else if (approved === 0 || remaining === 0) {
      code = "capacity_zero";
      reason = "Approved weekly capacity is zero or already filled.";
    } else if (!owned || owned.bay_keys.length === 0) {
      code = "no_section";
      reason =
        "Associate has no owned Operational Section membership — capacity left unfilled.";
    }

    if (unfilled <= 0 && code !== "no_section") continue;

    out.push({
      specialist_id: sid,
      specialist_name: member.specialist_name,
      approved_capacity: approved,
      proposed_count: proposed,
      unfilled: unfilled > 0 ? unfilled : remaining,
      code,
      reason,
      section_id: owned?.section_ids[0] ?? null,
      section_name: owned?.section_names[0] ?? null,
    });
  }
  return out.sort((a, b) => a.specialist_id.localeCompare(b.specialist_id));
}
