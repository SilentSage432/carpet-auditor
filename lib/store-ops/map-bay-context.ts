/**
 * MAP-002 — Map bay operational context (compose only).
 *
 * Reads existing weekly_rotations, sunday_bay_assignments, and walkthrough
 * rows. Does not mutate ownership, rotation, Zebra, or sections.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAisle } from "./aisle";
import { filterActiveWeeklyRotations } from "./rotation-history";
import {
  isRotationPendingVerification,
  isRotationReportedComplete,
  isRotationVerifiedComplete,
} from "./rotation-metrics";
import {
  formatBayTag,
  resolveVerificationStatus,
  type RotationVerificationStatus,
  type StoreLocation,
  type WeeklyRotation,
} from "./types";
import {
  annotateObservationFollowUpState,
  formatWalkthroughPlaceLabel,
  isFollowUpNeedingAttention,
  isObservationAwaitingFollowUpDecision,
  listWalkthroughPlaceHistory,
  observationTypeLabel,
  resolveWalkthroughPlaceOwnership,
  type WalkthroughFollowUpRow,
  type WalkthroughFollowUpView,
  type WalkthroughObservationView,
  type WalkthroughPlaceOwnership,
} from "./walkthroughs";
import { isoWeekLabel } from "./week";

export type MapBayWeekLifecycle =
  | "not_in_week"
  | "planned"
  | "assigned"
  | "reported"
  | "awaiting_verification"
  | "verified";

export type MapBayWeekContext = {
  lifecycle: MapBayWeekLifecycle;
  status_label: string;
  assigned_week: string | null;
  assignee_name: string | null;
  assignee_specialist_id: string | null;
  verification_status: RotationVerificationStatus | null;
  rotation_id: string | null;
  /** Existing This Week surface — no Map write forms. */
  this_week_href: "/dashboard";
};

export type MapBayRotationHistoryItem = {
  id: string;
  location_id: string;
  surface: "SELLING" | "TOPSTOCK" | "UNKNOWN";
  assigned_week: string;
  is_completed: boolean;
  verification_status: RotationVerificationStatus;
  verified_at: string | null;
  completed_at: string | null;
  status_label: string;
  assignee_name: string | null;
};

export type MapBayFollowUpItem = WalkthroughFollowUpView & {
  needs_attention: boolean;
};

export type MapBayContext = {
  department_id: string;
  aisle: string;
  bay: number;
  place_label: string;
  location_ids: string[];
  week: MapBayWeekContext;
  rotation_history: MapBayRotationHistoryItem[];
  observations: WalkthroughObservationView[];
  open_follow_ups: MapBayFollowUpItem[];
  attention_follow_ups: MapBayFollowUpItem[];
  completed_follow_ups: MapBayFollowUpItem[];
  review_observations: WalkthroughObservationView[];
  place_ownership: WalkthroughPlaceOwnership | null;
};

export type MapBayContextResult =
  | { ok: true; value: MapBayContext }
  | { ok: false; code: string; message: string; details?: unknown };

function isMissingRelation(
  err: { message?: string; code?: string } | null
): boolean {
  if (!err) return false;
  const msg = String(err.message ?? "");
  return (
    err.code === "42P01" ||
    /relation .* does not exist|Could not find the table/i.test(msg)
  );
}

export function mapBayWeekStatusLabel(
  lifecycle: MapBayWeekLifecycle
): string {
  switch (lifecycle) {
    case "not_in_week":
      return "Not in this week’s plan";
    case "planned":
      return "Planned — no owner yet";
    case "assigned":
      return "Assigned this week";
    case "reported":
      return "Reported complete";
    case "awaiting_verification":
      return "Awaiting verification";
    case "verified":
      return "Verified";
    default:
      return "Unknown";
  }
}

export function mapBayRotationHistoryLabel(input: {
  verification_status: RotationVerificationStatus;
  is_completed: boolean;
}): string {
  const status = resolveVerificationStatus(input);
  if (status === "VERIFIED_COMPLETE") return "Verified";
  if (status === "PENDING_VERIFICATION") return "Awaiting verification";
  if (input.is_completed) return "Reported complete";
  return "Open";
}

/**
 * Pure: compose this-week status for one physical bay from active rotations
 * and optional Sunday assignment. Does not invent ownership.
 */
export function composeMapBayWeekContext(input: {
  assignedWeek: string;
  rotations: WeeklyRotation[];
  assigneeName?: string | null;
  assigneeSpecialistId?: string | null;
}): MapBayWeekContext {
  const week = String(input.assignedWeek ?? "").trim();
  const active = filterActiveWeeklyRotations(
    input.rotations.map((r) => ({ ...r, store_locations: null }))
  ).filter((r) => String(r.assigned_week ?? "") === week);

  if (active.length === 0) {
    return {
      lifecycle: "not_in_week",
      status_label: mapBayWeekStatusLabel("not_in_week"),
      assigned_week: week || null,
      assignee_name: null,
      assignee_specialist_id: null,
      verification_status: null,
      rotation_id: null,
      this_week_href: "/dashboard",
    };
  }

  // Prefer the rotation still needing attention when both faces exist.
  const ranked = [...active].sort((a, b) => {
    const score = (r: WeeklyRotation) => {
      if (isRotationPendingVerification(r)) return 4;
      if (isRotationReportedComplete(r)) return 3;
      if (!isRotationVerifiedComplete(r)) return 2;
      return 1;
    };
    return score(b) - score(a);
  });
  const primary = ranked[0];
  const assigneeName = String(input.assigneeName ?? "").trim() || null;
  const assigneeId = String(input.assigneeSpecialistId ?? "").trim() || null;

  let lifecycle: MapBayWeekLifecycle = "planned";
  if (isRotationVerifiedComplete(primary)) lifecycle = "verified";
  else if (isRotationPendingVerification(primary))
    lifecycle = "awaiting_verification";
  else if (isRotationReportedComplete(primary)) lifecycle = "reported";
  else if (assigneeName || assigneeId) lifecycle = "assigned";
  else lifecycle = "planned";

  return {
    lifecycle,
    status_label: mapBayWeekStatusLabel(lifecycle),
    assigned_week: week || null,
    assignee_name: assigneeName,
    assignee_specialist_id: assigneeId,
    verification_status: resolveVerificationStatus(primary),
    rotation_id: primary.id,
    this_week_href: "/dashboard",
  };
}

/**
 * Pure: place-local follow-up attention from annotated observations + follow-ups.
 * Does not duplicate Overview overdue composition beyond needs_attention flags.
 */
export function composeMapBayFollowUpAttention(input: {
  observations: WalkthroughObservationView[];
  followUps: WalkthroughFollowUpView[];
  todayIsoDate: string;
}): {
  observations: WalkthroughObservationView[];
  open_follow_ups: MapBayFollowUpItem[];
  attention_follow_ups: MapBayFollowUpItem[];
  completed_follow_ups: MapBayFollowUpItem[];
  review_observations: WalkthroughObservationView[];
} {
  const annotated = input.observations.map((o) =>
    annotateObservationFollowUpState(o, input.followUps)
  );
  const open = input.followUps
    .filter((f) => f.status === "open")
    .map((f) => ({
      ...f,
      needs_attention: isFollowUpNeedingAttention(f, input.todayIsoDate),
    }))
    .sort((a, b) => {
      if (a.needs_attention !== b.needs_attention) {
        return a.needs_attention ? -1 : 1;
      }
      return String(b.created_at).localeCompare(String(a.created_at));
    });
  const completed = input.followUps
    .filter((f) => f.status === "done")
    .sort((a, b) =>
      String(b.completed_at ?? b.updated_at).localeCompare(
        String(a.completed_at ?? a.updated_at)
      )
    )
    .slice(0, 6)
    .map((f) => ({ ...f, needs_attention: false }));

  return {
    observations: annotated,
    open_follow_ups: open,
    attention_follow_ups: open.filter((f) => f.needs_attention),
    completed_follow_ups: completed,
    review_observations: annotated.filter((o) =>
      isObservationAwaitingFollowUpDecision(o)
    ),
  };
}

export async function listMapBayContext(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    department_id: string;
    aisle: string;
    bay: number;
    assignedWeek?: string;
    todayIsoDate: string;
    historyLimit?: number;
  }
): Promise<MapBayContextResult> {
  const storeId = String(input.store_id ?? "").trim();
  const departmentId = String(input.department_id ?? "").trim();
  const aisle = normalizeAisle(input.aisle);
  const bay = Number(input.bay);
  if (!storeId || !departmentId || !aisle || !Number.isFinite(bay)) {
    return { ok: false, code: "invalid", message: "Place is required" };
  }
  const assignedWeek = String(input.assignedWeek ?? isoWeekLabel()).trim();
  const historyLimit = input.historyLimit ?? 8;

  const { data: locations, error: locError } = await supabase
    .from("store_locations")
    .select("id, aisle, bay, type, department_id, store_id")
    .eq("store_id", storeId)
    .eq("department_id", departmentId)
    .eq("aisle", aisle)
    .eq("bay", bay);

  if (locError) {
    return {
      ok: false,
      code: "list_failed",
      message: locError.message,
      details: locError,
    };
  }

  const faces = (locations ?? []) as Array<
    Pick<StoreLocation, "id" | "aisle" | "bay" | "type" | "department_id">
  >;
  const locationIds = faces.map((f) => String(f.id));
  const surfaceById = new Map(
    faces.map((f) => [
      String(f.id),
      f.type === "SELLING" || f.type === "TOPSTOCK" ? f.type : "UNKNOWN",
    ] as const)
  );

  const [obsResult, ownership] = await Promise.all([
    listWalkthroughPlaceHistory(supabase, {
      store_id: storeId,
      department_id: departmentId,
      aisle,
      bay,
      limit: 12,
    }),
    resolveWalkthroughPlaceOwnership(supabase, {
      store_id: storeId,
      department_id: departmentId,
      aisle,
      bay,
    }),
  ]);

  if (!obsResult.ok && obsResult.code !== "missing_relation") {
    return obsResult;
  }
  const observations =
    obsResult.ok ? obsResult.value : ([] as WalkthroughObservationView[]);

  let followUpRows: WalkthroughFollowUpRow[] = [];
  if (observations.length > 0) {
    const obsIds = observations.map((o) => o.id);
    const { data: fuData, error: fuError } = await supabase
      .from("walkthrough_follow_ups")
      .select("*")
      .eq("store_id", storeId)
      .in("observation_id", obsIds)
      .order("created_at", { ascending: false })
      .limit(40);
    if (fuError && !isMissingRelation(fuError)) {
      return {
        ok: false,
        code: "list_failed",
        message: fuError.message,
        details: fuError,
      };
    }
    if (!isMissingRelation(fuError)) {
      followUpRows = (fuData ?? []) as WalkthroughFollowUpRow[];
    }
  }

  const responsibleIds = followUpRows.map(
    (f) => f.responsible_specialist_id ?? ""
  );
  const nameMap = new Map<string, string>();
  const nameIds = [...new Set(responsibleIds.filter(Boolean))];
  if (nameIds.length > 0) {
    const { data: people } = await supabase
      .from("store_specialists")
      .select("id, name")
      .in("id", nameIds);
    for (const p of people ?? []) {
      nameMap.set(String(p.id), String(p.name ?? "").trim());
    }
  }

  const obsById = new Map(observations.map((o) => [o.id, o]));
  const followUpViews: WalkthroughFollowUpView[] = followUpRows.map((f) => {
    const obs = obsById.get(f.observation_id);
    return {
      ...f,
      responsible_name: f.responsible_specialist_id
        ? nameMap.get(f.responsible_specialist_id) ?? null
        : null,
      observation_body: obs?.body ?? null,
      observation_type: obs?.observation_type ?? null,
      place_label: formatWalkthroughPlaceLabel({ aisle, bay }),
      section_name: obs?.section_name ?? null,
    };
  });

  const followAttention = composeMapBayFollowUpAttention({
    observations,
    followUps: followUpViews,
    todayIsoDate: input.todayIsoDate,
  });

  let rotationRows: Array<
    WeeklyRotation & { verified_at?: string | null }
  > = [];
  if (locationIds.length > 0) {
    const { data: rotData, error: rotError } = await supabase
      .from("weekly_rotations")
      .select(
        "id, store_id, department_id, location_id, assigned_week, is_completed, completed_at, verification_status, verified_at, superseded_at, created_at"
      )
      .eq("store_id", storeId)
      .in("location_id", locationIds)
      .order("assigned_week", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(Math.max(historyLimit * 2, 16));

    if (rotError) {
      // Legacy columns without verification — still useful.
      const legacy = await supabase
        .from("weekly_rotations")
        .select(
          "id, store_id, department_id, location_id, assigned_week, is_completed, completed_at, superseded_at, created_at"
        )
        .eq("store_id", storeId)
        .in("location_id", locationIds)
        .order("assigned_week", { ascending: false })
        .limit(16);
      if (legacy.error) {
        return {
          ok: false,
          code: "list_failed",
          message: legacy.error.message,
          details: legacy.error,
        };
      }
      rotationRows = (legacy.data ?? []) as WeeklyRotation[];
    } else {
      rotationRows = (rotData ?? []) as Array<
        WeeklyRotation & { verified_at?: string | null }
      >;
    }
  }

  const weekRotations = rotationRows.filter(
    (r) => String(r.assigned_week ?? "") === assignedWeek && !r.superseded_at
  );
  const weekRotationIds = weekRotations.map((r) => r.id);
  let assigneeName: string | null = null;
  let assigneeSpecialistId: string | null = null;
  const assigneeByRotation = new Map<string, string>();

  if (weekRotationIds.length > 0) {
    const { data: assigns, error: assignError } = await supabase
      .from("sunday_bay_assignments")
      .select(
        "bay_id, specialist_id, specialist_name, roster_specialist_id, assigned_specialist_id"
      )
      .in("bay_id", weekRotationIds);
    if (!assignError && assigns) {
      for (const row of assigns) {
        const bayId = String(row.bay_id ?? "");
        const name = String(row.specialist_name ?? "").trim();
        const sid = String(
          row.roster_specialist_id || row.specialist_id || ""
        ).trim();
        if (bayId && name) assigneeByRotation.set(bayId, name);
        if (!assigneeName && name) {
          assigneeName = name;
          assigneeSpecialistId = sid || null;
        }
      }
    }
  }

  const week = composeMapBayWeekContext({
    assignedWeek,
    rotations: weekRotations,
    assigneeName,
    assigneeSpecialistId,
  });

  const rotation_history: MapBayRotationHistoryItem[] = rotationRows
    .filter((r) => !r.superseded_at)
    .slice(0, historyLimit)
    .map((r) => {
      const status = resolveVerificationStatus(r);
      return {
        id: r.id,
        location_id: r.location_id,
        surface: surfaceById.get(r.location_id) ?? "UNKNOWN",
        assigned_week: String(r.assigned_week ?? ""),
        is_completed: Boolean(r.is_completed),
        verification_status: status,
        verified_at: r.verified_at ?? null,
        completed_at: r.completed_at ?? null,
        status_label: mapBayRotationHistoryLabel({
          verification_status: status,
          is_completed: Boolean(r.is_completed),
        }),
        assignee_name:
          String(r.assigned_week ?? "") === assignedWeek
            ? assigneeByRotation.get(r.id) ?? null
            : null,
      };
    });

  return {
    ok: true,
    value: {
      department_id: departmentId,
      aisle,
      bay,
      place_label:
        formatWalkthroughPlaceLabel({ aisle, bay }) ??
        formatBayTag({ aisle, bay }),
      location_ids: locationIds,
      week,
      rotation_history,
      observations: followAttention.observations.map((o) => ({
        ...o,
        type_label: o.type_label ?? observationTypeLabel(o.observation_type),
      })),
      open_follow_ups: followAttention.open_follow_ups,
      attention_follow_ups: followAttention.attention_follow_ups,
      completed_follow_ups: followAttention.completed_follow_ups,
      review_observations: followAttention.review_observations,
      place_ownership: ownership.ok ? ownership.value : null,
    },
  };
}
