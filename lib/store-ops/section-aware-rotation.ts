/**
 * DEPTSYNC-SECTION-ROTATION-002 — deterministic Hybrid section-aware preference.
 *
 * Pure composition only. Does not persist assignments, mutate sections/topology,
 * invent undocumented bays, or activate Sunday auto-stage.
 *
 * Activation boundary: SECTION_AWARE_ROTATION_AUTO_STAGE remains false.
 * Preview UI opt-in: NEXT_PUBLIC_DEPTSYNC_SECTION_AWARE_PREVIEW=1 (default off).
 */

import { normalizeAisle } from "./aisle";
import { physicalBayKey } from "./physical-bay";
import type { BaySectionLookup } from "./operational-sections";
import {
  BASE_WEEKLY_BAY_QUOTA,
  formatShiftTag,
  type AssociateLoadPreview,
  type BayAssignmentPlanItem,
  type ProportionalAssignmentPlan,
  type RotationBayRef,
  type ShiftRosterMember,
} from "./weekly-rotations";
import type { StoreWeekCapacitySnapshot } from "./shared-week-capacity";

/**
 * Hard off for production Sunday automatic Stage+Assign.
 * This milestone must not flip this to true.
 */
export const SECTION_AWARE_ROTATION_AUTO_STAGE = false as const;

/** Env opt-in for local/review preview UI only. Default: disabled. */
export function isSectionAwarePreviewEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  return String(env.NEXT_PUBLIC_DEPTSYNC_SECTION_AWARE_PREVIEW ?? "").trim() === "1";
}

/** Authoritative coverage priority tiers — never leapfrogged by section preference. */
export type SectionAwarePriorityTier =
  | "carry"
  | "seasonal"
  | "high"
  | "velocity"
  | "aging";

export const SECTION_AWARE_TIER_ORDER: readonly SectionAwarePriorityTier[] = [
  "carry",
  "seasonal",
  "high",
  "velocity",
  "aging",
] as const;

export type SectionAwareBayCandidate = {
  department_id: string;
  aisle: string;
  bay: number;
  /** Optional stable identity for staged rotations. */
  rotationId?: string;
  riskScore?: number;
  /** Location/surface id when selecting from topology (not invented). */
  location_id?: string;
};

export type SectionAwarePreferenceKind =
  | "steward_match"
  | "section_coverage"
  | "coverage_fallback";

export type SectionAwarePreviewItem = BayAssignmentPlanItem & {
  /** Preview rows are never ownership truth. */
  state: "PROPOSED";
  department_id: string;
  physical_key: string;
  section_id: string | null;
  section_name: string | null;
  steward_specialist_id: string | null;
  steward_name: string | null;
  preference: SectionAwarePreferenceKind;
  priority_tier: SectionAwarePriorityTier | null;
};

export type SectionAwareWeeklyPreview = {
  state: "PROPOSED";
  week_label: string;
  store_number: string;
  fingerprint: string;
  items: SectionAwarePreviewItem[];
  loads: AssociateLoadPreview[];
  total_hours: number;
  shared_target: number;
  owned_total: number;
  remaining_shared: number;
  remaining_by_specialist: Record<string, number>;
  /** Incomplete topology: we only propose among supplied candidates. */
  topology_note: string;
  section_membership_count: number;
  steward_match_count: number;
  coverage_fallback_count: number;
};

function resolvePlannerHours(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 10) / 10;
}

export function sectionAwarePhysicalKey(bay: {
  department_id: string;
  aisle: string | number;
  bay: number | string;
}): string {
  return physicalBayKey({
    department_id: String(bay.department_id ?? "").trim(),
    aisle: bay.aisle,
    bay: bay.bay,
  });
}

export function lookupBaySection(
  bay: { department_id: string; aisle: string | number; bay: number | string },
  baySectionByKey: ReadonlyMap<string, BaySectionLookup> | null | undefined
): BaySectionLookup | null {
  if (!baySectionByKey || baySectionByKey.size === 0) return null;
  return baySectionByKey.get(sectionAwarePhysicalKey(bay)) ?? null;
}

function preferenceForBay(
  section: BaySectionLookup | null,
  assigneeId: string
): SectionAwarePreferenceKind {
  const steward = String(section?.primary_owner_specialist_id ?? "").trim();
  if (section && steward && steward === assigneeId) return "steward_match";
  if (section) return "section_coverage";
  return "coverage_fallback";
}

/**
 * Within a single priority tier, prefer:
 * 1) bays stewarded by an eligible associate
 * 2) any actively sectioned bay
 * 3) unsectioned
 * then stable physical key. Never crosses tiers.
 */
export function rankBaysWithinPriorityTier(
  tiers: ReadonlyArray<{
    tier: SectionAwarePriorityTier;
    candidates: readonly SectionAwareBayCandidate[];
  }>,
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>,
  eligibleSpecialistIds: ReadonlySet<string> | readonly string[]
): SectionAwareBayCandidate[] {
  const eligible = new Set(
    [...eligibleSpecialistIds].map((id) => String(id).trim()).filter(Boolean)
  );

  const rankKey = (bay: SectionAwareBayCandidate): string => {
    const section = lookupBaySection(bay, baySectionByKey);
    const steward = String(section?.primary_owner_specialist_id ?? "").trim();
    const stewardEligible = steward && eligible.has(steward) ? 0 : 1;
    const sectioned = section ? 0 : 1;
    const key = sectionAwarePhysicalKey(bay);
    return `${stewardEligible}|${sectioned}|${key}`;
  };

  const out: SectionAwareBayCandidate[] = [];
  for (const tierName of SECTION_AWARE_TIER_ORDER) {
    const bucket = tiers.find((t) => t.tier === tierName);
    if (!bucket || bucket.candidates.length === 0) continue;
    const sorted = [...bucket.candidates].sort((a, b) =>
      rankKey(a).localeCompare(rankKey(b))
    );
    out.push(...sorted);
  }
  // Any unexpected tier labels append last (stable) — should not occur in tests.
  for (const bucket of tiers) {
    if (
      (SECTION_AWARE_TIER_ORDER as readonly string[]).includes(bucket.tier)
    ) {
      continue;
    }
    out.push(
      ...[...bucket.candidates].sort((a, b) =>
        rankKey(a).localeCompare(rankKey(b))
      )
    );
  }
  return out;
}

/**
 * Draw N candidates preserving tier order with within-tier section preference.
 * Empty membership / missing stewards → coverage-first within each tier.
 */
export function selectBaysWithSectionPreference(
  tiers: ReadonlyArray<{
    tier: SectionAwarePriorityTier;
    candidates: readonly SectionAwareBayCandidate[];
  }>,
  drawCount: number,
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>,
  eligibleSpecialistIds: ReadonlySet<string> | readonly string[]
): SectionAwareBayCandidate[] {
  const n = Math.max(0, Math.floor(drawCount));
  if (n === 0) return [];
  const ordered = rankBaysWithinPriorityTier(
    tiers,
    baySectionByKey,
    eligibleSpecialistIds
  );
  const seen = new Set<string>();
  const selected: SectionAwareBayCandidate[] = [];
  for (const bay of ordered) {
    const key = sectionAwarePhysicalKey(bay);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(bay);
    if (selected.length >= n) break;
  }
  return selected;
}

export type SectionAwareBayRef = RotationBayRef & {
  department_id: string;
  /** Optional explicit tier label for preview communication. */
  priority_tier?: SectionAwarePriorityTier | null;
};

function bayFace(bay: number): "odd" | "even" {
  return Number(bay) % 2 === 0 ? "even" : "odd";
}

function clusterSectionAwareBays(bays: SectionAwareBayRef[]): SectionAwareBayRef[] {
  const groups = new Map<string, SectionAwareBayRef[]>();
  for (const bay of bays) {
    const aisle = normalizeAisle(bay.aisle) || "—";
    const face = bayFace(bay.bay);
    const key = `${aisle}|${face}`;
    const list = groups.get(key) ?? [];
    list.push(bay);
    groups.set(key, list);
  }
  const clusters = [...groups.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => {
      if ((b.riskScore ?? 0) !== (a.riskScore ?? 0)) {
        return (b.riskScore ?? 0) - (a.riskScore ?? 0);
      }
      return a.bay - b.bay;
    });
    const risk = sorted.reduce((sum, b) => sum + (b.riskScore ?? 0), 0);
    return { key, risk, bays: sorted };
  });
  clusters.sort((a, b) => {
    if (b.risk !== a.risk) return b.risk - a.risk;
    return a.key.localeCompare(b.key);
  });
  return clusters.flatMap((c) => c.bays);
}

/**
 * Flat capacity-aware assignment with steward soft preference.
 * Preserves multi-associate fairness: iterates coverage-ordered bays and
 * picks among associates with remaining capacity — steward match is a
 * tie-break boost, not exclusive ownership and not first-come all bays.
 */
export function planSectionAwareFlatAssignments(
  bays: SectionAwareBayRef[],
  members: ShiftRosterMember[],
  remainingCaps: ReadonlyMap<string, number>,
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>,
  options?: { knownHoursOnly?: boolean }
): ProportionalAssignmentPlan & {
  preference_by_rotation: Record<string, SectionAwarePreferenceKind>;
} {
  const knownHoursOnly = options?.knownHoursOnly !== false;
  const active = members
    .filter((m) => {
      if (!m.active) return false;
      if (knownHoursOnly && resolvePlannerHours(m.hours) <= 0) return false;
      if (!knownHoursOnly && resolvePlannerHours(m.hours) <= 0) return false;
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
    preference_by_rotation: {} as Record<string, SectionAwarePreferenceKind>,
  };
  if (bays.length === 0 || active.length === 0) return empty;

  const hours = active.map((m) => resolvePlannerHours(m.hours));
  const totalHours = hours.reduce((sum, h) => sum + h, 0);
  const remaining = active.map((m) =>
    Math.max(0, Math.floor(remainingCaps.get(m.specialist_id) ?? 0))
  );
  const quotas = [...remaining];
  const lastAisle = active.map(() => "");
  const items: BayAssignmentPlanItem[] = [];
  const preference_by_rotation: Record<string, SectionAwarePreferenceKind> = {};
  const queue = clusterSectionAwareBays(bays);

  for (const bay of queue) {
    const section = lookupBaySection(bay, baySectionByKey);
    const stewardId = String(section?.primary_owner_specialist_id ?? "").trim();
    let pick = -1;
    let best = -1;
    for (let i = 0; i < active.length; i += 1) {
      if ((remaining[i] ?? 0) <= 0) continue;
      const member = active[i]!;
      const sameAisle = lastAisle[i] === normalizeAisle(bay.aisle) ? 2 : 0;
      const stewardMatch =
        stewardId && stewardId === member.specialist_id ? 1 : 0;
      // Steward boost cannot invent capacity; only ranks among remaining caps.
      // Same-aisle remains meaningful; specialist_id order breaks ties.
      const score =
        stewardMatch * 10_000 +
        sameAisle * 1_000 +
        (remaining[i] ?? 0) * 10 +
        (active.length - i);
      if (score > best) {
        best = score;
        pick = i;
      }
    }
    if (pick < 0) break;
    const member = active[pick]!;
    remaining[pick] = (remaining[pick] ?? 0) - 1;
    lastAisle[pick] = normalizeAisle(bay.aisle);
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
    preference_by_rotation[bay.rotationId] = preferenceForBay(
      section,
      member.specialist_id
    );
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

export function buildSectionAwarePreviewFingerprint(input: {
  store_number: string;
  week_label: string;
  rotation_ids: readonly string[];
  assignee_ids: readonly string[];
  section_member_keys: readonly string[];
  owned_total: number;
  remaining_shared: number;
  eligible_ids: readonly string[];
}): string {
  const parts = [
    String(input.store_number ?? "").trim(),
    String(input.week_label ?? "").trim(),
    [...input.rotation_ids].map(String).sort().join(","),
    [...input.assignee_ids].map(String).join("|"),
    [...input.section_member_keys].map(String).sort().join(","),
    String(input.owned_total),
    String(input.remaining_shared),
    [...input.eligible_ids].map(String).sort().join(","),
  ];
  return parts.join("::");
}

export function assertSectionAwarePreviewFresh(
  expectedFingerprint: string,
  recomputed: SectionAwareWeeklyPreview
): { ok: true } | { ok: false; code: "STALE_PREVIEW"; message: string } {
  if (
    String(expectedFingerprint ?? "").trim() &&
    expectedFingerprint === recomputed.fingerprint
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "STALE_PREVIEW",
    message:
      "Section-aware preview is outdated (schedules, assignments, sections, or capacity changed). Refresh before assigning.",
  };
}

/**
 * Compose a PROPOSED weekly ownership preview. Never persists.
 * Only considers supplied staged/candidate bays — does not invent topology.
 * Skips already-owned rotation ids.
 */
/**
 * Build remaining capacity caps from eligible associates + current owned counts.
 * Presentation helper — authoritative enforcement remains the capacity RPC.
 */
export function buildPreviewCapacityCaps(input: {
  eligibleSpecialistIds: readonly string[];
  ownedBySpecialist: Readonly<Record<string, number>>;
  ownedTotal: number;
  quotaPerPerson?: number;
  /** ROTATION-005: when set, shared = sum(approved) and per-person remaining uses caps. */
  approvedBySpecialist?: Readonly<Record<string, number>>;
}): Pick<
  StoreWeekCapacitySnapshot,
  | "shared_target"
  | "owned_total"
  | "remaining_shared"
  | "remaining_by_specialist"
  | "eligible_specialist_ids"
  | "approved_by_specialist"
  | "approvals_complete"
> {
  const quota = Math.max(
    0,
    Math.floor(input.quotaPerPerson ?? BASE_WEEKLY_BAY_QUOTA)
  );
  const eligible_specialist_ids = [
    ...new Set(
      input.eligibleSpecialistIds.map((id) => String(id).trim()).filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b));
  const owned_total = Math.max(0, Math.floor(input.ownedTotal));
  const usingApprovals = input.approvedBySpecialist != null;
  const approved_by_specialist: Record<string, number> = {};
  let shared_target = 0;
  let approvals_complete = usingApprovals && eligible_specialist_ids.length > 0;
  const remaining_by_specialist: Record<string, number> = {};

  for (const id of eligible_specialist_ids) {
    const owned = Math.max(0, Math.floor(input.ownedBySpecialist[id] ?? 0));
    if (usingApprovals) {
      const raw = Number(input.approvedBySpecialist?.[id]);
      const cap =
        Number.isInteger(raw) && raw >= 0 && raw <= quota ? raw : null;
      if (cap == null) {
        approvals_complete = false;
        approved_by_specialist[id] = 0;
        remaining_by_specialist[id] = 0;
        continue;
      }
      approved_by_specialist[id] = cap;
      shared_target += cap;
      remaining_by_specialist[id] = Math.max(0, cap - owned);
    } else {
      shared_target = eligible_specialist_ids.length * quota;
      remaining_by_specialist[id] = Math.max(0, quota - owned);
    }
  }
  if (!usingApprovals) {
    shared_target = eligible_specialist_ids.length * quota;
  } else if (eligible_specialist_ids.length === 0) {
    approvals_complete = false;
    shared_target = 0;
  }

  return {
    eligible_specialist_ids,
    shared_target,
    owned_total,
    remaining_shared: Math.max(0, shared_target - owned_total),
    remaining_by_specialist,
    ...(usingApprovals
      ? { approved_by_specialist, approvals_complete }
      : {}),
  };
}

export function composeSectionAwareWeeklyPreview(input: {
  store_number: string;
  week_label: string;
  bays: SectionAwareBayRef[];
  members: ShiftRosterMember[];
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>;
  /** rotationId → already owned (non-cleared). */
  ownedRotationIds?: ReadonlySet<string> | readonly string[];
  capacity: Pick<
    StoreWeekCapacitySnapshot,
    | "shared_target"
    | "owned_total"
    | "remaining_shared"
    | "remaining_by_specialist"
    | "eligible_specialist_ids"
  >;
  knownHoursOnly?: boolean;
}): SectionAwareWeeklyPreview {
  const owned = new Set(
    [...(input.ownedRotationIds ?? [])].map((id) => String(id).trim()).filter(Boolean)
  );
  const unowned = input.bays.filter((b) => !owned.has(String(b.rotationId)));
  const remainingCaps = new Map<string, number>();
  for (const [id, n] of Object.entries(input.capacity.remaining_by_specialist ?? {})) {
    remainingCaps.set(String(id), Math.max(0, Math.floor(n)));
  }
  // Eligible members with no remaining map entry start at base quota.
  for (const id of input.capacity.eligible_specialist_ids ?? []) {
    if (!remainingCaps.has(id)) {
      remainingCaps.set(id, BASE_WEEKLY_BAY_QUOTA);
    }
  }

  const plan = planSectionAwareFlatAssignments(
    unowned,
    input.members,
    remainingCaps,
    input.baySectionByKey,
    { knownHoursOnly: input.knownHoursOnly !== false }
  );

  const sectionKeys = [...input.baySectionByKey.keys()].sort();
  const items: SectionAwarePreviewItem[] = plan.items.map((row) => {
    const bay = unowned.find((b) => b.rotationId === row.rotationId);
    const department_id = String(bay?.department_id ?? "").trim();
    const section = bay
      ? lookupBaySection(bay, input.baySectionByKey)
      : null;
    const preference =
      plan.preference_by_rotation[row.rotationId] ?? "coverage_fallback";
    return {
      ...row,
      state: "PROPOSED",
      department_id,
      physical_key: bay
        ? sectionAwarePhysicalKey(bay)
        : `${department_id}|${normalizeAisle(row.aisle)}|${row.bay}`,
      section_id: section?.section_id ?? null,
      section_name: section?.section_name ?? null,
      steward_specialist_id: section?.primary_owner_specialist_id ?? null,
      steward_name: section?.primary_owner_name ?? null,
      preference,
      priority_tier: bay?.priority_tier ?? null,
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

  return {
    state: "PROPOSED",
    week_label: input.week_label,
    store_number: input.store_number,
    fingerprint,
    items,
    loads: plan.loads,
    total_hours: plan.total_hours,
    shared_target: input.capacity.shared_target,
    owned_total: input.capacity.owned_total,
    remaining_shared: input.capacity.remaining_shared,
    remaining_by_specialist: { ...input.capacity.remaining_by_specialist },
    topology_note:
      "PROPOSED only among known staged/candidate bays. Undocumented topology is not invented. Incomplete section membership degrades to coverage-first.",
    section_membership_count: sectionKeys.length,
    steward_match_count: items.filter((i) => i.preference === "steward_match")
      .length,
    coverage_fallback_count: items.filter(
      (i) => i.preference === "coverage_fallback"
    ).length,
  };
}
