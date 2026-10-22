/**
 * DEPTSYNC-OPS-OVERVIEW-001 — Supervisor Overview command composition.
 *
 * Pure presentation helpers over existing This Week, Walkthrough inbox, and
 * MAP-003 week-bay-priority evidence. Does not invent urgency scores, mutate
 * rotations, or invent section ownership.
 */

import { buildMapBayFocusHref } from "./map-bay-focus";
import { formatBayTag, resolveVerificationStatus } from "./types";
import type {
  ThisWeekOwnedBay,
  ThisWeekOwnershipPlan,
  ThisWeekOwner,
} from "./this-week-ownership";
import type {
  WalkthroughFollowUpView,
  WalkthroughInbox,
  WalkthroughObservationView,
} from "./walkthroughs";
import type { WeekBayPriorityView } from "./week-bay-priority";
import type { OperationalSectionView } from "./operational-sections";

export type OverviewAttentionKind =
  | "week_no_plan"
  | "week_unowned"
  | "week_verify"
  | "week_barrier"
  | "week_call_out"
  | "week_sent_back"
  | "followup_overdue";

/**
 * One persisted associate_shift_days call-out fact.
 * Store and week filters are applied here so Overview does not invent absence.
 */
export type OverviewCallOutRow = {
  specialistId: string;
  workDate: string;
  isCallOut: boolean;
  /** When set, must match `storeNumber` or the row is ignored. */
  storeNumber?: string | null;
};

export type OverviewAttentionItem = {
  id: string;
  kind: OverviewAttentionKind;
  label: string;
  detail: string | null;
  ownerLabel: string | null;
  href: string;
  mapHref: string | null;
};

export type OverviewFollowUpRow = {
  id: string;
  observationId: string;
  label: string;
  detail: string | null;
  ownerLabel: string | null;
  needsAttention: boolean;
  href: string;
  mapHref: string | null;
};

export type OverviewReviewRow = {
  id: string;
  label: string;
  detail: string | null;
  ownerLabel: string | null;
  href: string;
  mapHref: string | null;
};

export type OverviewPriorityRow = {
  id: string;
  label: string;
  detail: string | null;
  ownerLabel: string | null;
  /** Explicit copy: intent only — not an assignment. */
  intentNote: string;
  href: string;
  mapHref: string;
  weekLabel: string;
};

export type OverviewPersonRow = {
  specialistId: string;
  specialistName: string;
  roleLabel: string | null;
  verifiedCount: number;
  bayCount: number;
  /** Dominant section stewardship among owned bays, when known. */
  sectionLabel: string | null;
};

/** Walkthroughs deep-link — opens observation detail when the tab supports it. */
export function buildWalkthroughObservationHref(observationId: string): string {
  const id = String(observationId ?? "").trim();
  if (!id) return "/walkthroughs";
  return `/walkthroughs?observation=${encodeURIComponent(id)}`;
}

export function overviewPlaceMapHref(input: {
  department_id?: string | null;
  aisle?: string | null;
  bay?: number | null;
}): string | null {
  const aisle = String(input.aisle ?? "").trim();
  if (!aisle) return null;
  const bay = Number(input.bay);
  if (!Number.isFinite(bay) || bay < 0) return null;
  return buildMapBayFocusHref({
    aisle,
    bay,
    departmentId: input.department_id ?? null,
  });
}

/**
 * Honest ownership line from section metadata already attached to evidence.
 * Does not invent a steward from rotation history.
 */
export function composeOverviewOwnerLabel(input: {
  sectionName?: string | null;
  ownerName?: string | null;
  ownershipMissing?: boolean;
  ownershipAmbiguous?: boolean;
}): string | null {
  if (input.ownershipAmbiguous) return "Section ownership unclear";
  if (input.ownershipMissing) return "No section owner";
  const owner = String(input.ownerName ?? "").trim();
  const section = String(input.sectionName ?? "").trim();
  if (owner && section) return `${section} · ${owner}`;
  if (owner) return `Section owner: ${owner}`;
  if (section) return section;
  return null;
}

function sectionOwnerById(
  sections: ReadonlyArray<
    Pick<
      OperationalSectionView,
      "id" | "name" | "primary_owner_name" | "primary_owner_specialist_id"
    >
  >
): Map<string, { name: string; ownerName: string | null }> {
  const map = new Map<string, { name: string; ownerName: string | null }>();
  for (const s of sections) {
    map.set(s.id, {
      name: s.name,
      ownerName: s.primary_owner_name?.trim() || null,
    });
  }
  return map;
}

function ownerLabelForSectionId(
  sectionId: string | null | undefined,
  sectionName: string | null | undefined,
  sectionsById: Map<string, { name: string; ownerName: string | null }>
): string | null {
  const id = String(sectionId ?? "").trim();
  const fromMap = id ? sectionsById.get(id) : undefined;
  return composeOverviewOwnerLabel({
    sectionName: fromMap?.name ?? sectionName,
    ownerName: fromMap?.ownerName ?? null,
    ownershipMissing: Boolean(id && fromMap && !fromMap.ownerName),
  });
}

/** Needs-attention list — evidence only; review opportunities stay separate. */
export function composeOverviewAttention(input: {
  plan: ThisWeekOwnershipPlan | null;
  inbox: WalkthroughInbox | null;
  sections?: ReadonlyArray<
    Pick<
      OperationalSectionView,
      "id" | "name" | "primary_owner_name" | "primary_owner_specialist_id"
    >
  >;
  /**
   * Call-out rows already loaded for the actor's store.
   * Omitted or empty week dates → no call-out items (do not guess).
   */
  callOuts?: ReadonlyArray<OverviewCallOutRow> | null;
  /** Monday–Sunday dates (YYYY-MM-DD) of the operational week the plan belongs to. */
  operationalWeekDates?: readonly string[] | null;
  /** When set, call-out rows for any other store are ignored. */
  storeNumber?: string | null;
  /**
   * When set, only bays in these department ids count.
   * The weekly-rotations API already scopes the plan; this is a second check.
   */
  departmentIds?: readonly string[] | null;
}): OverviewAttentionItem[] {
  const items: OverviewAttentionItem[] = [];
  const plan = input.plan;
  if (plan?.needsDispatchRecovery) {
    items.push({
      id: "no-plan",
      kind: "week_no_plan",
      label: "No weekly plan staged yet",
      detail: "Open This Week to stage or assign coverage.",
      ownerLabel: null,
      href: "/dashboard",
      mapHref: null,
    });
  }
  if (plan?.needsOwnershipRecovery) {
    items.push({
      id: "unowned",
      kind: "week_unowned",
      label: `${plan.unownedPhysicalBayCount} staged bay${
        plan.unownedPhysicalBayCount === 1 ? "" : "s"
      } still need an owner`,
      detail: "Assignment required — not completion evidence.",
      ownerLabel: null,
      href: "/dashboard",
      mapHref: null,
    });
  }
  if (plan && plan.pendingVerificationCount > 0) {
    items.push({
      id: "verify",
      kind: "week_verify",
      label: `${plan.pendingVerificationCount} bay${
        plan.pendingVerificationCount === 1 ? "" : "s"
      } awaiting verification`,
      detail: null,
      ownerLabel: null,
      href: "/dashboard",
      mapHref: null,
    });
  }
  if (plan && plan.barrierBayCount > 0) {
    items.push({
      id: "barrier",
      kind: "week_barrier",
      label: `${plan.barrierBayCount} bay${
        plan.barrierBayCount === 1 ? "" : "s"
      } with an open barrier`,
      detail: null,
      ownerLabel: null,
      href: "/dashboard",
      mapHref: null,
    });
  }

  items.push(
    ...composeCallOutAttention({
      plan,
      callOuts: input.callOuts,
      operationalWeekDates: input.operationalWeekDates,
      storeNumber: input.storeNumber,
      departmentIds: input.departmentIds,
    })
  );
  items.push(
    ...composeSentBackAttention({
      plan,
      departmentIds: input.departmentIds,
    })
  );

  const sectionsById = sectionOwnerById(input.sections ?? []);
  const overdue = input.inbox?.attention_follow_ups ?? [];
  for (const fu of overdue.slice(0, 6)) {
    items.push(followUpToAttention(fu, sectionsById));
  }
  return items;
}

const THIS_WEEK_HREF = "/dashboard";

function weekDateSet(dates: readonly string[] | null | undefined): Set<string> {
  const set = new Set<string>();
  for (const date of dates ?? []) {
    const trimmed = String(date ?? "").trim();
    if (trimmed) set.add(trimmed);
  }
  return set;
}

function departmentAllowed(
  departmentId: string | null | undefined,
  departmentIds: readonly string[] | null | undefined
): boolean {
  if (!departmentIds || departmentIds.length === 0) return true;
  const id = String(departmentId ?? "").trim();
  return departmentIds.some((allowed) => allowed === id);
}

function bayInDepartments(
  bay: ThisWeekOwnedBay,
  departmentIds: readonly string[] | null | undefined
): boolean {
  return departmentAllowed(bay.rotation.department_id, departmentIds);
}

/** Assigned work that is not yet verified. Verified bays are no longer owed. */
function bayStillOwed(bay: ThisWeekOwnedBay): boolean {
  return bay.isAssigned && bay.lifecycle !== "verified";
}

/**
 * Send-back leaves verification_status PENDING and a coaching review_note.
 * Re-report moves the bay to PENDING_VERIFICATION and clears the note.
 * Verify clears the note and sets VERIFIED_COMPLETE.
 * Those later states stay in the existing verify category or drop out.
 */
function bayNeedsSentBackCorrection(bay: ThisWeekOwnedBay): boolean {
  if (!bay.isAssigned) return false;
  if (resolveVerificationStatus(bay.rotation) !== "PENDING") return false;
  return String(bay.rotation.review_note ?? "").trim().length > 0;
}

function bayMapHref(bay: ThisWeekOwnedBay): string | null {
  return overviewPlaceMapHref({
    department_id: bay.rotation.department_id,
    aisle: bay.aisle,
    bay: bay.bay,
  });
}

function joinBayLabels(bays: readonly ThisWeekOwnedBay[]): string {
  const labels = bays.map((bay) => bay.label);
  if (labels.length <= 4) return labels.join(" · ");
  return `${labels.slice(0, 4).join(" · ")} · and ${labels.length - 4} more`;
}

function composeCallOutAttention(input: {
  plan: ThisWeekOwnershipPlan | null;
  callOuts?: ReadonlyArray<OverviewCallOutRow> | null;
  operationalWeekDates?: readonly string[] | null;
  storeNumber?: string | null;
  departmentIds?: readonly string[] | null;
}): OverviewAttentionItem[] {
  const plan = input.plan;
  const dates = weekDateSet(input.operationalWeekDates);
  if (!plan || dates.size === 0) return [];

  const expectedStore = String(input.storeNumber ?? "").trim();
  const calledOut = new Set<string>();
  for (const row of input.callOuts ?? []) {
    if (row.isCallOut !== true) continue;
    const workDate = String(row.workDate ?? "").trim();
    if (!dates.has(workDate)) continue;
    const rowStore = String(row.storeNumber ?? "").trim();
    if (expectedStore && rowStore !== expectedStore) continue;
    if (!expectedStore && rowStore) continue;
    const specialistId = String(row.specialistId ?? "").trim();
    if (specialistId) calledOut.add(specialistId);
  }
  if (calledOut.size === 0) return [];

  const items: OverviewAttentionItem[] = [];
  const owners = [...plan.owners].sort((a, b) =>
    a.specialistName.localeCompare(b.specialistName)
  );
  for (const owner of owners) {
    if (!calledOut.has(owner.specialistId)) continue;
    const owed = owner.bays.filter(
      (bay) => bayStillOwed(bay) && bayInDepartments(bay, input.departmentIds)
    );
    if (owed.length === 0) continue;
    const bayWord = owed.length === 1 ? "bay" : "bays";
    items.push({
      id: `call-out-${owner.specialistId}`,
      kind: "week_call_out",
      label: `${owner.specialistName} has a call-out this week and still owns ${owed.length} ${bayWord}`,
      detail: `A call-out is recorded during this operational week. Ownership stays until you reassign on This Week. ${joinBayLabels(owed)}`,
      ownerLabel: owner.specialistName,
      href: THIS_WEEK_HREF,
      mapHref: owed.length === 1 ? bayMapHref(owed[0]!) : null,
    });
  }
  return items;
}

function composeSentBackAttention(input: {
  plan: ThisWeekOwnershipPlan | null;
  departmentIds?: readonly string[] | null;
}): OverviewAttentionItem[] {
  const plan = input.plan;
  if (!plan) return [];
  const bays: ThisWeekOwnedBay[] = [];
  for (const owner of plan.owners) {
    for (const bay of owner.bays) {
      if (!bayInDepartments(bay, input.departmentIds)) continue;
      if (!bayNeedsSentBackCorrection(bay)) continue;
      bays.push(bay);
    }
  }
  bays.sort((a, b) => {
    const aisle = a.aisle.localeCompare(b.aisle, undefined, { numeric: true });
    if (aisle !== 0) return aisle;
    return a.bay - b.bay;
  });
  if (bays.length === 0) return [];
  const bayWord = bays.length === 1 ? "bay was" : "bays were";
  return [
    {
      id: "sent-back",
      kind: "week_sent_back",
      label: `${bays.length} ${bayWord} sent back for correction`,
      detail: joinBayLabels(bays),
      ownerLabel: null,
      href: THIS_WEEK_HREF,
      mapHref: bays.length === 1 ? bayMapHref(bays[0]!) : null,
    },
  ];
}

function followUpToAttention(
  fu: WalkthroughFollowUpView,
  sectionsById: Map<string, { name: string; ownerName: string | null }>
): OverviewAttentionItem {
  const place = fu.place_label?.trim() || null;
  return {
    id: `fu-${fu.id}`,
    kind: "followup_overdue",
    label: fu.action_text,
    detail: [place, fu.due_on ? `Due ${fu.due_on}` : null]
      .filter(Boolean)
      .join(" · ") || null,
    ownerLabel: ownerLabelForSectionId(
      fu.section_id,
      fu.section_name,
      sectionsById
    ),
    href: buildWalkthroughObservationHref(fu.observation_id),
    mapHref: overviewPlaceMapHref({
      department_id: fu.department_id,
      aisle: fu.aisle,
      bay: fu.bay,
    }),
  };
}

export function composeOverviewOpenFollowUps(input: {
  inbox: WalkthroughInbox | null;
  sections?: ReadonlyArray<
    Pick<
      OperationalSectionView,
      "id" | "name" | "primary_owner_name" | "primary_owner_specialist_id"
    >
  >;
  limit?: number;
}): OverviewFollowUpRow[] {
  const sectionsById = sectionOwnerById(input.sections ?? []);
  const limit = input.limit ?? 5;
  const open = input.inbox?.open_follow_ups ?? [];
  return open.slice(0, limit).map((fu) => ({
    id: fu.id,
    observationId: fu.observation_id,
    label: fu.action_text,
    detail: [fu.place_label?.trim() || null, fu.due_on ? `Due ${fu.due_on}` : null]
      .filter(Boolean)
      .join(" · ") || null,
    ownerLabel: ownerLabelForSectionId(
      fu.section_id,
      fu.section_name,
      sectionsById
    ),
    needsAttention: Boolean(fu.needs_attention),
    href: buildWalkthroughObservationHref(fu.observation_id),
    mapHref: overviewPlaceMapHref({
      department_id: fu.department_id,
      aisle: fu.aisle,
      bay: fu.bay,
    }),
  }));
}

export function composeOverviewReviewRows(input: {
  inbox: WalkthroughInbox | null;
  sections?: ReadonlyArray<
    Pick<
      OperationalSectionView,
      "id" | "name" | "primary_owner_name" | "primary_owner_specialist_id"
    >
  >;
  limit?: number;
}): OverviewReviewRow[] {
  const sectionsById = sectionOwnerById(input.sections ?? []);
  const limit = input.limit ?? 4;
  const review = input.inbox?.review_observations ?? [];
  return review.slice(0, limit).map((obs: WalkthroughObservationView) => ({
    id: obs.id,
    label: obs.body,
    detail: obs.place_label?.trim() || null,
    ownerLabel: ownerLabelForSectionId(
      obs.section_id,
      obs.section_name,
      sectionsById
    ),
    href: buildWalkthroughObservationHref(obs.id),
    mapHref: overviewPlaceMapHref({
      department_id: obs.department_id,
      aisle: obs.aisle,
      bay: obs.bay,
    }),
  }));
}

/**
 * Next-week supervisory priorities (MAP-003).
 * Priority ≠ assignment ≠ approved Sunday ownership.
 */
export function composeOverviewPriorityRows(input: {
  priorities: ReadonlyArray<WeekBayPriorityView>;
  weekLabel: string;
  limit?: number;
}): OverviewPriorityRow[] {
  const limit = input.limit ?? 6;
  const weekLabel = String(input.weekLabel ?? "").trim();
  return input.priorities
    .filter((p) => p.active)
    .slice(0, limit)
    .map((p) => {
      const place = formatBayTag({ aisle: p.aisle, bay: p.bay });
      const mapHref = buildMapBayFocusHref({
        aisle: p.aisle,
        bay: p.bay,
        departmentId: p.department_id,
      });
      return {
        id: p.id,
        label: place,
        detail: p.section_name?.trim() || null,
        ownerLabel: composeOverviewOwnerLabel({
          sectionName: p.section_name,
          ownerName: null,
          ownershipMissing: !p.owner_specialist_id && !p.section_id,
        }),
        intentNote: "Priority intent — not an assignment",
        href: mapHref,
        mapHref,
        weekLabel: p.week_label || weekLabel,
      };
    });
}

/** People strip: weekly assignees + optional stewardship hint from owned bays. */
export function composeOverviewPeopleRows(
  plan: ThisWeekOwnershipPlan | null
): OverviewPersonRow[] {
  if (!plan) return [];
  return plan.owners.map((owner) => ({
    specialistId: owner.specialistId,
    specialistName: owner.specialistName,
    roleLabel: owner.roleLabel,
    verifiedCount: owner.verifiedCount,
    bayCount: owner.bays.length,
    sectionLabel: dominantSectionLabel(owner),
  }));
}

function dominantSectionLabel(owner: ThisWeekOwner): string | null {
  const counts = new Map<string, number>();
  for (const bay of owner.bays) {
    const name = bay.section?.section_name?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best: string | null = null;
  let bestN = 0;
  for (const [name, n] of counts) {
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  }
  return best;
}
