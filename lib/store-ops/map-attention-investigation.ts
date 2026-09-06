/**
 * UX-004 Floor → Map Current Attention investigation — navigation intent +
 * presentation selection only.
 *
 * Passes why the DS navigated (investigate current-attention for a department).
 * Map resolves elevated locations from its own canonical SI response.
 * Does NOT recompute pressure / confidence / actionability / reasons.
 * Does NOT rank, recommend, or filter geography.
 *
 * Constitutional: Arts VII–IX, XI, XIII, XV–XVI, XX — navigation context is not
 * authorization and not intelligence authority.
 */

import { ADMIN_PINNABLE_DEPARTMENTS } from "@/lib/admin-department-context";
import type { OperationalDepartment } from "@/lib/types";
import type { AttentionPressure } from "./location-attention-pressure";
import type { LocationAttentionSignal } from "./location-attention-contract";
import type { MapAttentionClientStatus } from "./location-attention-presentation";
import {
  ATTENTION_NEEDS_DEPARTMENT_LABEL,
  ATTENTION_UNAVAILABLE_STATUS_LABEL,
} from "./location-attention-presentation";
import {
  composeLocationAttentionSummary,
  formatAttentionTierCountLine,
} from "./location-attention-summary";

export const MAP_INVESTIGATE_PARAM = "investigate" as const;
export const MAP_INVESTIGATE_CURRENT_ATTENTION = "current-attention" as const;
export const MAP_INVESTIGATE_DEPT_PARAM = "dept" as const;

export const MAP_ATTENTION_INVESTIGATION_QUIET =
  "No Medium/High Current Attention now" as const;

export const MAP_ATTENTION_INVESTIGATION_LOADING =
  "Loading current attention…" as const;

export type MapAttentionInvestigationIntent = {
  kind: "current-attention";
  /** Hub operational department code — navigation context, not authorization. */
  departmentScope: OperationalDepartment;
};

export type MapAttentionInvestigationView = {
  active: true;
  kind: "current-attention";
  departmentScope: OperationalDepartment;
  title: "Current attention";
  body: string;
  provenance: "Derived";
  high_count: number;
  medium_count: number;
  elevated_count: number;
  /**
   * Location IDs with MEDIUM/HIGH from current SI — presentation selection only.
   * Order follows the SI signal list (canonical geographic order), never pressure rank.
   */
  relevant_location_ids: string[];
  /** Always false for UX-004 — geography preserved; markers emphasized in place. */
  geography_filtered: false;
  status: MapAttentionClientStatus;
  show_clear: true;
};

const PINNABLE = new Set<string>(ADMIN_PINNABLE_DEPARTMENTS);

export function isElevatedAttentionPressure(
  pressure: AttentionPressure
): boolean {
  return pressure === "MEDIUM" || pressure === "HIGH";
}

/**
 * Presentation selection from canonical SI pressures.
 * MEDIUM/HIGH only — same elevated set as Floor summary + Map markers.
 */
export function selectElevatedAttentionLocationIds(
  signals: ReadonlyArray<LocationAttentionSignal>
): string[] {
  const ids: string[] = [];
  for (const signal of signals) {
    if (isElevatedAttentionPressure(signal.pressure)) {
      ids.push(signal.location_id);
    }
  }
  return ids;
}

export function parseMapAttentionInvestigationSearchParams(
  searchParams: URLSearchParams | { get(name: string): string | null }
): MapAttentionInvestigationIntent | null {
  const investigate = searchParams.get(MAP_INVESTIGATE_PARAM);
  if (investigate !== MAP_INVESTIGATE_CURRENT_ATTENTION) return null;
  const dept = searchParams.get(MAP_INVESTIGATE_DEPT_PARAM);
  if (!dept || !PINNABLE.has(dept)) return null;
  return {
    kind: "current-attention",
    departmentScope: dept as OperationalDepartment,
  };
}

/**
 * Drop investigation intent when the department is not in the actor's accessible set.
 * URL params never grant foreign-department access.
 */
export function resolveMapAttentionInvestigationIntent(input: {
  searchParams: URLSearchParams | { get(name: string): string | null };
  allowedDepartmentScopes: ReadonlyArray<OperationalDepartment | string>;
}): MapAttentionInvestigationIntent | null {
  const intent = parseMapAttentionInvestigationSearchParams(input.searchParams);
  if (!intent) return null;
  if (!input.allowedDepartmentScopes.includes(intent.departmentScope)) {
    return null;
  }
  return intent;
}

export function buildMapCurrentAttentionHref(input: {
  departmentScope: OperationalDepartment;
}): string {
  const qs = new URLSearchParams();
  qs.set(MAP_INVESTIGATE_PARAM, MAP_INVESTIGATE_CURRENT_ATTENTION);
  qs.set(MAP_INVESTIGATE_DEPT_PARAM, input.departmentScope);
  return `/admin/store-map?${qs.toString()}`;
}

export function clearMapAttentionInvestigationHref(): string {
  return "/admin/store-map";
}

/**
 * True when the URL still carries Current Attention investigation context.
 * Used by Show all exit — independent of SI result contents.
 */
export function hasMapAttentionInvestigationSearchParams(
  searchParams: URLSearchParams | { get(name: string): string | null }
): boolean {
  return parseMapAttentionInvestigationSearchParams(searchParams) != null;
}

/**
 * Exit Current Attention investigation navigation context.
 *
 * Invariant (UX-004B): if the URL contains valid investigation context,
 * activating Show all removes that context regardless of SI result
 * (elevated / quiet / degraded / unavailable / loading).
 *
 * Soft `router.replace` alone can leave keep-alive MapTab `useSearchParams`
 * stale for search-param-only exits on the null store-map page. Callers SHOULD
 * pass `syncBrowserUrl` that synchronously normalizes the visible URL via
 * History **replaceState** (preserving existing history.state), then
 * `replace` for App Router reconciliation. Still **replace** (no push /
 * assign / reload).
 */
export function exitMapAttentionInvestigation(input: {
  replace: (href: string) => void;
  /** When set, runs before replace to sync the browser URL (replaceState). */
  syncBrowserUrl?: (href: string) => void;
}): string {
  const href = clearMapAttentionInvestigationHref();
  input.syncBrowserUrl?.(href);
  input.replace(href);
  return href;
}

/**
 * Browser History sync for investigation exit (client-only; no SSR access).
 * Preserves existing `history.state` and replaces only the URL — equivalent to
 * `history.replaceState(history.state, "", "/admin/store-map")`.
 * Does not push, reload, or clear unrelated history metadata.
 */
export function syncMapAttentionInvestigationClearUrl(href: string): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (params.get(MAP_INVESTIGATE_PARAM) !== MAP_INVESTIGATE_CURRENT_ATTENTION) {
    return;
  }
  window.history.replaceState(window.history.state, "", href);
}

function signalsToArray(
  signals:
    | ReadonlyArray<LocationAttentionSignal>
    | ReadonlyMap<string, LocationAttentionSignal>
): LocationAttentionSignal[] {
  if (Array.isArray(signals)) return [...signals];
  return Array.from(signals.values());
}

/**
 * Compose investigation strip state from navigation intent + Map's current SI.
 * Stale Floor counts are never accepted — current SI always wins.
 */
export function composeMapAttentionInvestigationView(input: {
  intent: MapAttentionInvestigationIntent | null;
  attentionStatus: MapAttentionClientStatus;
  signals:
    | ReadonlyArray<LocationAttentionSignal>
    | ReadonlyMap<string, LocationAttentionSignal>;
}): MapAttentionInvestigationView | null {
  if (!input.intent) return null;

  const list = signalsToArray(input.signals);
  const summary = composeLocationAttentionSummary(list);
  const status = input.attentionStatus;

  let body: string;
  let relevant_location_ids: string[];

  if (status === "IDLE" || status === "LOADING") {
    body = MAP_ATTENTION_INVESTIGATION_LOADING;
    relevant_location_ids = [];
  } else if (status === "NEEDS_DEPARTMENT") {
    body = ATTENTION_NEEDS_DEPARTMENT_LABEL;
    relevant_location_ids = [];
  } else if (status === "UNAVAILABLE") {
    body = ATTENTION_UNAVAILABLE_STATUS_LABEL;
    relevant_location_ids = [];
  } else {
    // AVAILABLE | DEGRADED — current SI counts only
    body =
      formatAttentionTierCountLine(summary) ??
      MAP_ATTENTION_INVESTIGATION_QUIET;
    relevant_location_ids = selectElevatedAttentionLocationIds(list);
  }

  return {
    active: true,
    kind: "current-attention",
    departmentScope: input.intent.departmentScope,
    title: "Current attention",
    body,
    provenance: "Derived",
    high_count: summary.highCount,
    medium_count: summary.mediumCount,
    elevated_count: summary.mediumOrHighCount,
    relevant_location_ids,
    geography_filtered: false,
    status,
    show_clear: true,
  };
}
