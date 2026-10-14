/**
 * DEPTSYNC-OPS-OVERVIEW-001 — Supervisor Overview command composition.
 *
 * Pure presentation helpers over existing This Week, Walkthrough inbox, and
 * MAP-003 week-bay-priority evidence. Does not invent urgency scores, mutate
 * rotations, or invent section ownership.
 */

import { buildMapBayFocusHref } from "./map-bay-focus";
import { formatBayTag } from "./types";
import type { ThisWeekOwnershipPlan, ThisWeekOwner } from "./this-week-ownership";
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
  | "followup_overdue";

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

  const sectionsById = sectionOwnerById(input.sections ?? []);
  const overdue = input.inbox?.attention_follow_ups ?? [];
  for (const fu of overdue.slice(0, 6)) {
    items.push(followUpToAttention(fu, sectionsById));
  }
  return items;
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
