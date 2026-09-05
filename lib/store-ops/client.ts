/**
 * Browser client helpers for Store Operations APIs.
 */

import type { StoreSpecialist } from "@/lib/types";
import { invalidateRosterCache } from "@/lib/specialists";
import { getStoreNumber, normalizeStoreNumber } from "@/lib/store";
import { enqueueOrExecute, type EnqueueOrExecuteResult } from "@/lib/sync-queue";
import { actorFromSpecialist, storeOpsAuthHeadersAsync } from "./auth";
import {
  isStoreOpsAuthFailureMessage,
  STORE_OPS_AUTH_HINT,
} from "./auth-soft";
import { readableError } from "./errors";
import {
  clearDurable,
  durableListKey,
  peekDurable,
  putDurable,
} from "./cache";
import { createTtlCache } from "./ttl-cache";
import {
  buildLocalShiftBriefing,
  buildSessionRefreshShiftBriefing,
  isShiftBriefingTransportError,
} from "./shift-briefing";
import type { WalkParseResult } from "./ai-walk-parse";
import type {
  BayServiceIntensity,
  BayServiceLog,
  BulkGenerateInput,
  Department,
  LocationWorkflowType,
  StoreLocation,
  VelocityTier,
  WeeklyRotationWithLocation,
} from "./types";

const STORE_OPS_LIST_TTL_MS = 45_000;

const departmentsCache = createTtlCache<StoreOpsListResult<Department>>(
  STORE_OPS_LIST_TTL_MS
);
const rotationsCache = createTtlCache<{
  assigned_week: string;
  rotations: WeeklyRotationWithLocation[];
}>(STORE_OPS_LIST_TTL_MS);
const locationsCache = createTtlCache<StoreOpsListResult<StoreLocation>>(
  STORE_OPS_LIST_TTL_MS
);
const healthCache = createTtlCache<StoreHealthSnapshotClient>(
  STORE_OPS_LIST_TTL_MS
);

function storeOpsListCacheKey(
  specialist: StoreSpecialist,
  extra = ""
): string {
  return `${specialist.id}:${getStoreNumber()}:${extra}`;
}

function durableStore(
  specialist: StoreSpecialist,
  storeNumber?: string | null
): string {
  return normalizeStoreNumber(
    storeNumber || getStoreNumber() || specialist.store_number || ""
  );
}

function durableKey(
  kind: "store_locations" | "weekly_rotations" | "shift_briefings",
  specialist: StoreSpecialist,
  extra = "",
  storeNumber?: string | null
): string {
  return durableListKey(
    kind,
    specialist.id,
    durableStore(specialist, storeNumber),
    extra
  );
}

function rememberDurable<T>(
  kind: "store_locations" | "weekly_rotations" | "shift_briefings",
  specialist: StoreSpecialist,
  extra: string,
  data: T,
  storeNumber?: string | null
): T {
  void putDurable(kind, durableKey(kind, specialist, extra, storeNumber), data);
  return data;
}

/** Drop cached Store Map / Zebra list GETs after writes. Awaits IndexedDB clear. */
export const STORE_OPS_LOCATIONS_CHANGED_EVENT =
  "deptsync:store-locations-changed";

export async function invalidateStoreOpsListCaches(): Promise<void> {
  departmentsCache.invalidate();
  rotationsCache.invalidate();
  locationsCache.invalidate();
  healthCache.invalidate();
  await clearDurable();
}

function notifyStoreLocationsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STORE_OPS_LOCATIONS_CHANGED_EVENT));
}

export async function peekCachedStoreLocations(
  specialist: StoreSpecialist,
  departmentId?: string
): Promise<StoreOpsListResult<StoreLocation> | undefined> {
  const qs = departmentId
    ? `?department_id=${encodeURIComponent(departmentId)}`
    : "";
  const row = await peekDurable<StoreOpsListResult<StoreLocation>>(
    "store_locations",
    durableKey("store_locations", specialist, qs)
  );
  return row?.data;
}

export async function peekCachedRotations(
  specialist: StoreSpecialist,
  departmentId?: string
): Promise<
  | {
      assigned_week: string;
      rotations: WeeklyRotationWithLocation[];
    }
  | undefined
> {
  const qs = departmentId
    ? `?department_id=${encodeURIComponent(departmentId)}`
    : "";
  const row = await peekDurable<{
    assigned_week: string;
    rotations: WeeklyRotationWithLocation[];
  }>("weekly_rotations", durableKey("weekly_rotations", specialist, qs));
  return row?.data;
}

export async function peekCachedDepartments(
  specialist: StoreSpecialist,
  storeNumber?: string | null
): Promise<StoreOpsListResult<Department> | undefined> {
  const store = normalizeStoreNumber(
    storeNumber || getStoreNumber() || specialist.store_number || ""
  );
  const row = await peekDurable<StoreOpsListResult<Department>>(
    "store_locations",
    durableKey("store_locations", specialist, `departments:${store}`, store)
  );
  return row?.data;
}

export type ShiftBriefingCachePayload = {
  snapshot: StoreHealthSnapshotClient;
  briefing: ShiftBriefingClient;
};

export async function peekCachedShiftBriefing(
  specialist: StoreSpecialist,
  week?: string
): Promise<ShiftBriefingCachePayload | undefined> {
  const row = await peekDurable<ShiftBriefingCachePayload>(
    "shift_briefings",
    durableKey("shift_briefings", specialist, week ?? "")
  );
  return row?.data;
}

async function storeOpsFetch<T>(
  path: string,
  specialist: StoreSpecialist,
  init?: RequestInit,
  storeNumber?: string | null
): Promise<T> {
  try {
    const actor = actorFromSpecialist(
      specialist,
      storeNumber || getStoreNumber()
    );
    if (!actor) {
      throw new Error("Store Operations access denied for this profile");
    }

    const authHeaders = await storeOpsAuthHeadersAsync(actor);
    const res = await fetch(path, {
      ...init,
      headers: {
        ...authHeaders,
        ...(init?.headers ?? {}),
      },
    });

    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      hint?: string;
      auth_required?: boolean;
      [key: string]: unknown;
    };

    if (!res.ok) {
      const detail = [body.error, body.hint].filter(Boolean).join(" — ");
      throw new Error(
        readableError(
          detail || `Request failed (${res.status})`,
          `Store Operations request failed (${res.status})`
        )
      );
    }

    return body as T;
  } catch (error) {
    // Preserve already-built Error messages — do not re-humanize / nest.
    if (error instanceof Error) throw error;
    throw new Error(readableError(error, "Store Operations request failed"));
  }
}

export type StoreOpsListResult<T> = {
  items: T[];
  authRequired: boolean;
  hint?: string;
};

export async function fetchDepartments(
  specialist: StoreSpecialist
): Promise<Department[]> {
  const result = await fetchDepartmentsDetailed(specialist);
  return result.items;
}

/** Departments list with soft Auth signal for Store Map / Settings tools. */
export async function fetchDepartmentsDetailed(
  specialist: StoreSpecialist,
  storeNumber?: string | null
): Promise<StoreOpsListResult<Department>> {
  const store = normalizeStoreNumber(
    storeNumber || getStoreNumber() || specialist.store_number || ""
  );
  if (!store) {
    return { items: [], authRequired: false };
  }

  return departmentsCache.getSWR(
    storeOpsListCacheKey(specialist, `departments:${store}`),
    async () => {
      try {
        const data = await storeOpsFetch<{
          departments: Department[];
          auth_required?: boolean;
          hint?: string;
        }>("/api/departments", specialist, undefined, store);
        const result = {
          items: data.departments ?? [],
          authRequired: Boolean(data.auth_required),
          hint: data.hint,
        };
        rememberDurable(
          "store_locations",
          specialist,
          `departments:${store}`,
          result,
          store
        );
        return result;
      } catch (err) {
        console.error("[fetchDepartmentsDetailed]", err);
        const message = String((err as { message?: string } | null)?.message ?? "");
        if (isStoreOpsAuthFailureMessage(message)) {
          return {
            items: [],
            authRequired: true,
            hint: STORE_OPS_AUTH_HINT,
          };
        }
        throw err;
      }
    }
  );
}

export async function fetchStoreLocations(
  specialist: StoreSpecialist,
  departmentId?: string
): Promise<StoreLocation[]> {
  const result = await fetchStoreLocationsDetailed(specialist, departmentId);
  return result.items;
}

export async function fetchStoreLocationsDetailed(
  specialist: StoreSpecialist,
  departmentId?: string
): Promise<StoreOpsListResult<StoreLocation>> {
  const qs = departmentId
    ? `?department_id=${encodeURIComponent(departmentId)}`
    : "";
  return locationsCache.getSWR(
    storeOpsListCacheKey(specialist, `locations:${qs}`),
    async () => {
      try {
        const data = await storeOpsFetch<{
          locations: StoreLocation[];
          auth_required?: boolean;
          hint?: string;
        }>(`/api/store-locations${qs}`, specialist);
        const result = {
          items: data.locations ?? [],
          authRequired: Boolean(data.auth_required),
          hint: data.hint,
        };
        rememberDurable("store_locations", specialist, qs, result);
        return result;
      } catch (err) {
        const message = String((err as { message?: string } | null)?.message ?? "");
        if (isStoreOpsAuthFailureMessage(message)) {
          return {
            items: [],
            authRequired: true,
            hint: STORE_OPS_AUTH_HINT,
          };
        }
        throw err;
      }
    }
  );
}

export async function bulkGenerateLocations(
  specialist: StoreSpecialist,
  input: BulkGenerateInput
): Promise<{ created: number; locations: StoreLocation[] }> {
  const data = await storeOpsFetch<{
    created: number;
    locations: StoreLocation[];
  }>("/api/store-locations/bulk", specialist, {
    method: "POST",
    body: JSON.stringify(input),
  });
  await invalidateStoreOpsListCaches();
  notifyStoreLocationsChanged();
  return data;
}

export type AiParsedLocationClient = {
  department_code: string;
  aisle: string;
  start_bay: number;
  end_bay: number;
  type: "SELLING" | "TOPSTOCK" | "BOTH";
};

export type AiParseLocationsResult = {
  locations: AiParsedLocationClient[];
  corrections_made: string[];
};

/** Super Admin — Gemini Pre-Flight parse of messy aisle/bay text or CSV. */
export async function aiParseLocations(
  specialist: StoreSpecialist,
  input: {
    text: string;
    known_department_codes?: string[];
    default_department_code?: string;
  }
): Promise<AiParseLocationsResult> {
  return storeOpsFetch("/api/store-locations/ai-parse", specialist, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Supervisor / Super Admin — Gemini floor-walk transcript → structured tasks. */
export async function parseFloorWalk(
  specialist: StoreSpecialist,
  input: {
    transcript: string;
    department_code?: string;
    roster_names?: string[];
    allow_local_fallback?: boolean;
  }
): Promise<WalkParseResult> {
  return storeOpsFetch("/api/copilot/parse-walk", specialist, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function logBayService(
  specialist: StoreSpecialist,
  input: {
    location_id: string;
    intensity: BayServiceIntensity;
    notes?: string | null;
  }
): Promise<{
  log: BayServiceLog;
  location: StoreLocation;
  velocity_tier: VelocityTier;
}> {
  const data = await storeOpsFetch<{
    log: BayServiceLog;
    location: StoreLocation;
    velocity_tier: VelocityTier;
  }>("/api/store-locations/service", specialist, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await invalidateStoreOpsListCaches();
  return data;
}

export async function patchStoreLocation(
  specialist: StoreSpecialist,
  id: string,
  patch: Partial<
    Pick<
      StoreLocation,
      | "is_active"
      | "status"
      | "location_type"
      | "audit_frequency_days"
      | "aisle"
      | "bay"
      | "type"
      | "department_id"
      | "priority_override"
      | "carried_over"
      | "last_carried_over_at"
      | "velocity_tier"
      | "custom_decay_days"
      | "workflow_type"
    >
  >
): Promise<StoreLocation> {
  const data = await storeOpsFetch<{ location: StoreLocation }>(
    "/api/store-locations",
    specialist,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    }
  );
  await invalidateStoreOpsListCaches();
  return data.location;
}

export async function applyDepartmentWorkflowType(
  specialist: StoreSpecialist,
  departmentId: string,
  workflowType: LocationWorkflowType
): Promise<{ updated: number; workflow_type: LocationWorkflowType }> {
  const data = await storeOpsFetch<{
    updated?: number;
    workflow_type?: LocationWorkflowType;
  }>("/api/store-locations", specialist, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apply_to_department: true,
      department_id: departmentId,
      workflow_type: workflowType,
    }),
  });
  await invalidateStoreOpsListCaches();
  notifyStoreLocationsChanged();
  return {
    updated: data.updated ?? 0,
    workflow_type: data.workflow_type ?? workflowType,
  };
}

export async function deleteStoreLocations(
  specialist: StoreSpecialist,
  ids: string[]
): Promise<{ deleted: number; pruned: number; ids: string[] }> {
  const unique = [...new Set(ids.map(String).filter(Boolean))];
  const data = await storeOpsFetch<{
    deleted?: number;
    pruned?: number;
    ids?: string[];
  }>("/api/store-locations", specialist, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: unique }),
  });
  const removed = data.ids ?? unique;
  const count = data.deleted ?? data.pruned ?? removed.length;
  await invalidateStoreOpsListCaches();
  return { deleted: count, pruned: count, ids: removed };
}

export async function deleteStoreLocation(
  specialist: StoreSpecialist,
  id: string
): Promise<{ deleted: number; ids: string[] }> {
  const data = await storeOpsFetch<{
    deleted?: number;
    ids?: string[];
  }>(`/api/store-locations?id=${encodeURIComponent(id)}`, specialist, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  await invalidateStoreOpsListCaches();
  return {
    deleted: data.deleted ?? 1,
    ids: data.ids ?? [id],
  };
}

/** @deprecated Prefer deleteStoreLocations — DELETE now removes tags. */
export async function pruneStoreLocations(
  specialist: StoreSpecialist,
  ids: string[]
): Promise<{ pruned: number; ids: string[] }> {
  const result = await deleteStoreLocations(specialist, ids);
  return { pruned: result.deleted, ids: result.ids };
}

export type BayRotationHistoryRow = {
  id: string;
  assigned_week: string;
  is_completed: boolean;
  completed_at: string | null;
  created_at?: string;
  location_id: string;
};

export async function fetchBayLocationHistory(
  specialist: StoreSpecialist,
  locationId: string
): Promise<{ location: StoreLocation; rotations: BayRotationHistoryRow[] }> {
  const data = await storeOpsFetch<{
    location: StoreLocation;
    rotations: BayRotationHistoryRow[];
  }>(
    `/api/store-locations/history?location_id=${encodeURIComponent(locationId)}`,
    specialist
  );
  return {
    location: data.location,
    rotations: data.rotations ?? [],
  };
}

export async function updateDepartmentAccess(
  specialist: StoreSpecialist,
  input: {
    specialist_id: string;
    accessible_departments: string[];
    assigned_department?: string | null;
  }
): Promise<{ accessible_departments: string[] }> {
  const data = await storeOpsFetch<{
    accessible_departments?: string[];
  }>("/api/admin/department-access", specialist, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await invalidateStoreOpsListCaches();
  return {
    accessible_departments: data.accessible_departments ?? [],
  };
}

export async function fetchThisWeekRotations(
  specialist: StoreSpecialist,
  departmentId?: string
): Promise<{
  assigned_week: string;
  rotations: WeeklyRotationWithLocation[];
}> {
  const qs = departmentId
    ? `?department_id=${encodeURIComponent(departmentId)}`
    : "";
  return rotationsCache.getSWR(
    storeOpsListCacheKey(specialist, `weekly-rotations:${qs}`),
    async () => {
      const data = await storeOpsFetch<{
        assigned_week?: string | null;
        rotations?: WeeklyRotationWithLocation[] | null;
      }>("/api/weekly-rotations" + qs, specialist);

      const week = String(data.assigned_week ?? "").trim();
      const rotations = Array.isArray(data.rotations)
        ? data.rotations.filter((r) => Boolean(r?.assigned_week))
        : [];

      const result = {
        assigned_week: week,
        rotations,
      };
      rememberDurable("weekly_rotations", specialist, qs, result);
      return result;
    }
  );
}

export type CompleteRotationExtras = {
  bay_id?: string;
  notes?: string;
  audit_verdict?: "PASS" | "CONDITIONAL" | "FAIL";
  audit_log_id?: string;
  supervisor_override?: boolean;
};

export class BayCompleteGatedError extends Error {
  readonly gated = true;
  readonly issues: Array<{
    issue: string;
    severity: string;
    recommendation: string;
  }>;
  readonly audit_log_id?: string;

  constructor(body: {
    message?: string;
    issues?: Array<{
      issue: string;
      severity: string;
      recommendation: string;
    }>;
    audit_log_id?: string | null;
  }) {
    super(
      body.message ??
        "Bay audit failed — fix issues or request supervisor override"
    );
    this.name = "BayCompleteGatedError";
    this.issues = body.issues ?? [];
    this.audit_log_id = body.audit_log_id ?? undefined;
  }
}

export async function completeRotation(
  specialist: StoreSpecialist,
  rotationId: string,
  extras?: CompleteRotationExtras
): Promise<EnqueueOrExecuteResult> {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    id: rotationId,
    rotation_id: rotationId,
    bay_id: extras?.bay_id ?? "",
    completed_by: specialist.name,
    completed_at: now,
    notes: extras?.notes ?? "",
    specialist_id: specialist.id,
    specialist_role: specialist.role,
    assigned_department: specialist.assigned_department,
    store_number: getStoreNumber() || specialist.store_number,
    audit_verdict: extras?.audit_verdict,
    audit_log_id: extras?.audit_log_id,
    supervisor_override: extras?.supervisor_override === true,
  };
  return enqueueOrExecute(
    "STORE_OPS_COMPLETE_ROTATION",
    payload,
    () => executeCompleteRotationLive(payload, specialist)
  );
}

const STORE_OPS_FETCH_TIMEOUT_MS = 20_000;

function mutationAbortSignal(): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined") return undefined;
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(STORE_OPS_FETCH_TIMEOUT_MS);
  }
  return undefined;
}

function specialistFromSyncPayload(
  payload: Record<string, unknown>,
  fallback?: StoreSpecialist
): StoreSpecialist {
  if (fallback) return fallback;
  const roleRaw = String(payload.specialist_role ?? "Associate");
  const role =
    roleRaw === "MasterAdmin" || roleRaw === "Supervisor"
      ? roleRaw
      : "Associate";
  return {
    id: String(payload.specialist_id ?? ""),
    name: String(payload.completed_by ?? payload.specialist_name ?? ""),
    role,
    pin_code: null,
    username: null,
    assigned_department:
      (payload.assigned_department as StoreSpecialist["assigned_department"]) ??
      null,
    must_change_credentials: false,
    is_active: true,
    store_number: String(payload.store_number ?? getStoreNumber()),
    created_at: new Date().toISOString(),
  };
}

/** Live POST /api/rotations/complete — used by completeRotation and queue replay. */
export async function executeCompleteRotationLive(
  payload: Record<string, unknown>,
  specialist?: StoreSpecialist
): Promise<void> {
  const rotationId = String(payload.rotation_id ?? payload.id ?? "").trim();
  if (!rotationId) throw new Error("rotation_id is required");
  const member = specialistFromSyncPayload(payload, specialist);
  const actor = actorFromSpecialist(
    member,
    String(payload.store_number ?? getStoreNumber())
  );
  if (!actor) {
    throw new Error("Store Operations access denied for this profile");
  }
  const authHeaders = await storeOpsAuthHeadersAsync(actor);
  const res = await fetch("/api/rotations/complete", {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rotation_id: rotationId,
      ...(payload.audit_verdict
        ? { audit_verdict: payload.audit_verdict }
        : {}),
      ...(payload.audit_log_id
        ? { audit_log_id: payload.audit_log_id }
        : {}),
      ...(payload.supervisor_override === true
        ? { supervisor_override: true }
        : {}),
    }),
    signal: mutationAbortSignal(),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    gated?: boolean;
    issues?: Array<{
      issue: string;
      severity: string;
      recommendation: string;
    }>;
    audit_log_id?: string | null;
    message?: string;
  };
  if (res.status === 422 && body.gated) {
    throw new BayCompleteGatedError(body);
  }
  if (!res.ok) {
    throw new Error(readableError(body.error, `Request failed (${res.status})`));
  }
  await invalidateStoreOpsListCaches();
  notifyStoreLocationsChanged();
}

export async function generateRotations(
  specialist: StoreSpecialist,
  departmentId: string,
  count: number,
  options?: { force?: boolean }
): Promise<{
  assigned_week: string;
  cycle_number: number;
  cycle_reset: boolean;
  created: number;
  skipped?: boolean;
  reason?: string;
  replaced?: number;
}> {
  const result = await storeOpsFetch<{
    assigned_week: string;
    cycle_number: number;
    cycle_reset: boolean;
    created: number;
    skipped?: boolean;
    reason?: string;
    replaced?: number;
  }>("/api/rotations/generate", specialist, {
    method: "POST",
    body: JSON.stringify({
      department_id: departmentId,
      count,
      force: options?.force === true,
    }),
  });
  await invalidateStoreOpsListCaches();
  return result;
}

export type GenerateRotationsBatchResult = {
  success_count: number;
  failed_count: number;
  staged_bays: number;
  assigned_week?: string;
  failures?: Array<{ department_id: string; error: string }>;
};

export async function generateRotationsBatch(
  specialist: StoreSpecialist,
  departmentIds: string[],
  bayCount: number,
  options?: { force?: boolean }
): Promise<GenerateRotationsBatchResult> {
  const uniqueIds = [...new Set(departmentIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    throw new Error("Select at least one department");
  }

  const result = await storeOpsFetch<GenerateRotationsBatchResult>(
    "/api/rotations/generate",
    specialist,
    {
      method: "POST",
      body: JSON.stringify({
        department_ids: uniqueIds,
        bay_count: bayCount,
        force_overwrite: options?.force === true,
      }),
    }
  );
  await invalidateStoreOpsListCaches();
  return result;
}

export type ResetStagedRotationResult = {
  ok: boolean;
  audit: {
    store_number: string;
    department_id: string;
    department_name: string;
    week_label: string;
    include_completed: boolean;
    deleted_rotations: number;
    superseded_rotations?: number;
    deleted_assignments: number;
    reset_locations: number;
    rotation_ids: string[];
  };
};

/** Master Admin — clear staged weekly_rotations for a department + ISO week. */
export async function resetStagedRotation(
  specialist: StoreSpecialist,
  departmentId: string,
  weekLabel: string,
  options?: { includeCompleted?: boolean }
): Promise<ResetStagedRotationResult> {
  const result = await storeOpsFetch<ResetStagedRotationResult>(
    "/api/admin/rotations/reset",
    specialist,
    {
      method: "POST",
      body: JSON.stringify({
        department_id: departmentId,
        week_label: weekLabel,
        include_completed: options?.includeCompleted !== false,
      }),
    }
  );
  await invalidateStoreOpsListCaches();
  return result;
}

export type StoreScheduleSettingsClient = {
  store_id: string;
  store_number: string;
  name: string | null;
  sunday_auto_generate: boolean;
  sunday_auto_stage_time: string;
  timezone: string;
  auto_stage_time_display: string;
  staging_week: string;
  dispatch: {
    would_run: boolean;
    reason: string;
    local_time: string;
    timezone: string;
    week_label: string;
  };
};

export async function fetchStoreScheduleSettings(
  specialist: StoreSpecialist
): Promise<StoreScheduleSettingsClient> {
  return storeOpsFetch<StoreScheduleSettingsClient>(
    "/api/stores/settings",
    specialist
  );
}

export async function updateStoreScheduleSettings(
  specialist: StoreSpecialist,
  patch: {
    sunday_auto_generate?: boolean;
    sunday_auto_stage_time?: string;
    timezone?: string;
  }
): Promise<StoreScheduleSettingsClient> {
  return storeOpsFetch<StoreScheduleSettingsClient>(
    "/api/stores/settings",
    specialist,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    }
  );
}

export async function updateDepartmentWeeklyTarget(
  specialist: StoreSpecialist,
  weeklyBayTarget: number,
  departmentId?: string
): Promise<Department> {
  const data = await storeOpsFetch<{ department: Department }>(
    "/api/departments",
    specialist,
    {
      method: "PATCH",
      body: JSON.stringify({
        weekly_bay_target: weeklyBayTarget,
        ...(departmentId ? { department_id: departmentId } : {}),
      }),
    }
  );
  await invalidateStoreOpsListCaches();
  return data.department;
}

/** Super Admin — pause / activate a department for Sunday cron + force draw. */
export async function updateDepartmentActive(
  specialist: StoreSpecialist,
  departmentId: string,
  isActive: boolean
): Promise<Department> {
  const data = await storeOpsFetch<{ department: Department }>(
    "/api/departments",
    specialist,
    {
      method: "PATCH",
      body: JSON.stringify({
        department_id: departmentId,
        is_active: isActive,
      }),
    }
  );
  await invalidateStoreOpsListCaches();
  return data.department;
}

/** Supervisor or Super Admin — add bay(s) to this week's rotation and bump adaptive priority. */
export async function assignLocationsToWeek(
  specialist: StoreSpecialist,
  locationIds: string[],
  departmentId?: string
): Promise<{ assigned_week: string; created: number }> {
  const result = await storeOpsFetch<{ assigned_week: string; created: number }>(
    "/api/rotations/assign",
    specialist,
    {
      method: "POST",
      body: JSON.stringify({
        location_ids: locationIds,
        ...(departmentId ? { department_id: departmentId } : {}),
      }),
    }
  );
  await invalidateStoreOpsListCaches();
  return result;
}

export async function fetchShowroomLocations(
  specialist: StoreSpecialist,
  departmentId?: string
): Promise<{ locations: StoreLocation[]; due: StoreLocation[] }> {
  const qs = departmentId
    ? `?department_id=${encodeURIComponent(departmentId)}`
    : "";
  const data = await storeOpsFetch<{
    locations?: StoreLocation[];
    due?: StoreLocation[];
  }>(`/api/showroom-locations${qs}`, specialist);
  return {
    locations: data.locations ?? [],
    due: data.due ?? [],
  };
}

export async function completeShowroomLocation(
  specialist: StoreSpecialist,
  locationId: string
): Promise<StoreLocation> {
  const data = await storeOpsFetch<{ location: StoreLocation }>(
    "/api/showroom-locations",
    specialist,
    {
      method: "POST",
      body: JSON.stringify({ location_id: locationId }),
    }
  );
  await invalidateStoreOpsListCaches();
  notifyStoreLocationsChanged();
  return data.location;
}

export async function verifyWeeklyRotationBatch(
  specialist: StoreSpecialist,
  input: {
    department_id: string;
    assigned_week: string;
    completed_rotation_ids: string[];
    incomplete: Array<{
      rotation_id: string;
      location_id: string;
      reason: string;
      cycle_number: number;
    }>;
  }
): Promise<{
  completed_count: number;
  exception_count: number;
}> {
  const result = await storeOpsFetch<{
    completed_count?: number;
    exception_count?: number;
  }>("/api/rotations/verify", specialist, {
    method: "POST",
    body: JSON.stringify(input),
  });
  await invalidateStoreOpsListCaches();
  return {
    completed_count: result.completed_count ?? 0,
    exception_count: result.exception_count ?? 0,
  };
}

/** Stamp the week verified without completing remaining open bays. */
export async function verifyAllCompletedBays(
  specialist: StoreSpecialist,
  input: { department_id: string; assigned_week: string }
): Promise<{ completed_count: number; exception_count: number }> {
  return verifyWeeklyRotationBatch(specialist, {
    department_id: input.department_id,
    assigned_week: input.assigned_week,
    completed_rotation_ids: [],
    incomplete: [],
  });
}

export type VerificationQueueItem = {
  rotation_id: string;
  department_id: string;
  location_id: string;
  aisle: string;
  bay: number;
  type: string | null;
  completed_at: string | null;
  completed_by: string | null;
  associate_name: string | null;
  review_note: string | null;
  assigned_week: string;
  audit: {
    id: string;
    verdict: string;
    image_url: string | null;
    created_at: string;
  } | null;
};

export async function fetchVerificationQueue(
  specialist: StoreSpecialist,
  input?: { department_id?: string; assigned_week?: string }
): Promise<{ assigned_week: string; pending_count: number; items: VerificationQueueItem[] }> {
  const qs = new URLSearchParams();
  if (input?.department_id) qs.set("department_id", input.department_id);
  if (input?.assigned_week) qs.set("assigned_week", input.assigned_week);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return storeOpsFetch<{
    assigned_week: string;
    pending_count: number;
    items: VerificationQueueItem[];
  }>(`/api/rotations/verify${suffix}`, specialist);
}

export async function verifyPendingBay(
  specialist: StoreSpecialist,
  rotationId: string,
  departmentId?: string
): Promise<void> {
  await storeOpsFetch("/api/rotations/verify", specialist, {
    method: "POST",
    body: JSON.stringify({
      review_action: "verify",
      rotation_id: rotationId,
      ...(departmentId ? { department_id: departmentId } : {}),
    }),
  });
  await invalidateStoreOpsListCaches();
  notifyStoreLocationsChanged();
}

export async function sendBackPendingBay(
  specialist: StoreSpecialist,
  rotationId: string,
  note: string,
  departmentId?: string
): Promise<void> {
  await storeOpsFetch("/api/rotations/verify", specialist, {
    method: "POST",
    body: JSON.stringify({
      review_action: "send_back",
      rotation_id: rotationId,
      note,
      ...(departmentId ? { department_id: departmentId } : {}),
    }),
  });
  await invalidateStoreOpsListCaches();
  notifyStoreLocationsChanged();
}

export async function verifyAllPendingBays(
  specialist: StoreSpecialist,
  input: { department_id?: string; assigned_week?: string }
): Promise<{ verified_count: number; assigned_week?: string }> {
  const result = await storeOpsFetch<{
    verified_count?: number;
    assigned_week?: string;
  }>("/api/rotations/verify", specialist, {
    method: "POST",
    body: JSON.stringify({
      review_action: "verify_all",
      department_id: input.department_id,
      assigned_week: input.assigned_week,
    }),
  });
  await invalidateStoreOpsListCaches();
  notifyStoreLocationsChanged();
  return {
    verified_count: result.verified_count ?? 0,
    assigned_week: result.assigned_week,
  };
}

export async function reportRotationBarriers(
  specialist: StoreSpecialist,
  input: {
    department_id: string;
    assigned_week: string;
    incomplete: Array<{
      rotation_id: string;
      location_id: string;
      reason: string;
      cycle_number: number;
    }>;
  }
): Promise<{ exception_count: number }> {
  const result = await storeOpsFetch<{ exception_count?: number }>(
    "/api/rotations/exceptions",
    specialist,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  await invalidateStoreOpsListCaches();
  return { exception_count: result.exception_count ?? input.incomplete.length };
}

export async function fetchExceptionSummary(
  specialist: StoreSpecialist,
  week?: string
): Promise<{
  assigned_week: string;
  summary: Array<{
    department_id: string;
    department_name: string;
    department_code: string;
    weekly_bay_target: number;
    last_verified_week: string | null;
    last_verified_at: string | null;
    verified_this_week: boolean;
    exception_count: number;
    incomplete_rotations: number;
    total_rotations: number;
  }>;
  exceptions: Array<{
    id: string;
    department_id: string;
    bay_id: string;
    reason: string;
    cycle_number: number;
    assigned_week: string | null;
    reported_by: string | null;
    created_at: string;
    store_locations: {
      id: string;
      aisle: string;
      bay: number;
      type?: string | null;
    } | null;
    departments: { id: string; name: string; code: string } | null;
  }>;
}> {
  const qs = week ? `?week=${encodeURIComponent(week)}` : "";
  const data = await storeOpsFetch<{
      assigned_week: string;
      summary: Array<{
        department_id: string;
        department_name: string;
        department_code: string;
        weekly_bay_target: number;
        last_verified_week: string | null;
        last_verified_at: string | null;
        verified_this_week: boolean;
        exception_count: number;
        incomplete_rotations: number;
        total_rotations: number;
      }>;
      exceptions: Array<{
        id: string;
        department_id: string;
        bay_id: string;
        reason: string;
        cycle_number: number;
        assigned_week: string | null;
        reported_by: string | null;
        created_at: string;
        store_locations: {
          id: string;
          aisle: string;
          bay: number;
          type?: string | null;
        } | null;
        departments: { id: string; name: string; code: string } | null;
      }>;
    }>(`/api/rotations/exceptions${qs}`, specialist);

    return {
      assigned_week: data.assigned_week ?? "",
      summary: data.summary ?? [],
      exceptions: data.exceptions ?? [],
    };
}

export type StoreHealthSnapshotClient = {
  assigned_week: string;
  store_id: string | null;
  scope: "store" | "department";
  department: {
    department_id: string;
    department_name: string;
    department_code: string;
    weekly_bay_target: number;
    assigned: number;
    completed: number;
    reported_complete: number;
    pending_verification: number;
    verified_complete: number;
    open: number;
    exception_count: number;
    completion_pct: number;
    verified_target_deficit: number;
  } | null;
  departments: Array<{
    department_id: string;
    department_name: string;
    department_code: string;
    weekly_bay_target: number;
    assigned: number;
    completed: number;
    reported_complete: number;
    pending_verification: number;
    verified_complete: number;
    open: number;
    exception_count: number;
    completion_pct: number;
    verified_target_deficit: number;
  }>;
  barriers: Array<{
    id: string;
    department_id: string;
    department_name: string;
    reason: string;
    created_at: string;
  }>;
  bottleneck_summary: Array<{ label: string; count: number }>;
  totals: {
    assigned: number;
    completed: number;
    reported_complete: number;
    pending_verification: number;
    verified_complete: number;
    open: number;
    exceptions: number;
    completion_pct: number;
    verified_target_deficit: number;
  };
  telemetry?: import("@/lib/store-ops/telemetry").StoreAuditTelemetry | null;
  bay_health?: import("@/lib/store-ops/bay-health").BayHealthBriefingContext | null;
  metrics_method?: string;
};

export async function fetchStoreHealth(
  specialist: StoreSpecialist,
  week?: string
): Promise<StoreHealthSnapshotClient> {
  const qs = week ? `?week=${encodeURIComponent(week)}` : "";
  return healthCache.getSWR(
    storeOpsListCacheKey(specialist, `store-health:${qs}`),
    async () => {
      const snapshot = await storeOpsFetch<StoreHealthSnapshotClient>(
        `/api/store-health${qs}`,
        specialist
      );
      rememberDurable("shift_briefings", specialist, week ?? "", {
        snapshot,
        briefing: localBriefingFromSnapshot(snapshot),
      });
      return snapshot;
    }
  );
}

export type ShiftBriefingClient = {
  headline: string;
  bullets: [string, string, string];
  priority_department: string;
  assigned_week?: string;
  source?: "gemini" | "local" | "session";
  auth_required?: boolean;
};

function localBriefingFromSnapshot(
  snapshot: StoreHealthSnapshotClient
): ShiftBriefingClient {
  const local = buildLocalShiftBriefing({
    assigned_week: snapshot.assigned_week,
    store_id: snapshot.store_id ?? "",
    scope: snapshot.scope,
    department: snapshot.department,
    departments: snapshot.departments,
    barriers: snapshot.barriers,
    bottleneck_summary: snapshot.bottleneck_summary,
    totals: snapshot.totals,
    telemetry: snapshot.telemetry ?? null,
    bay_health: snapshot.bay_health ?? null,
    metrics_method: "weekly-rotation-metrics-v1",
  } as import("@/lib/store-ops/health").StoreHealthSnapshot);
  return {
    ...local,
    assigned_week: snapshot.assigned_week,
    source: "local",
  };
}

/** Instant deterministic brief from store health — no Gemini. */
export function localShiftBriefingFromHealth(
  snapshot: StoreHealthSnapshotClient
): ShiftBriefingClient {
  return localBriefingFromSnapshot(snapshot);
}

/** Zebra Shift Intelligence Briefing from store health metrics + velocity. */
export async function fetchShiftBriefing(
  specialist: StoreSpecialist,
  options?: {
    week?: string;
    snapshot?: StoreHealthSnapshotClient;
    telemetry?: import("@/lib/store-ops/telemetry").StoreAuditTelemetry | null;
  }
): Promise<ShiftBriefingClient> {
  const fallback = options?.snapshot
    ? localBriefingFromSnapshot(options.snapshot)
    : null;
  try {
    return await storeOpsFetch<ShiftBriefingClient>(
      "/api/store-health/ai-summary",
      specialist,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(options?.week ? { week: options.week } : {}),
          ...(options?.snapshot ? { snapshot: options.snapshot } : {}),
          ...(options?.telemetry !== undefined
            ? { telemetry: options.telemetry }
            : {}),
        }),
      }
    );
  } catch (err) {
    const message = String((err as { message?: string } | null)?.message ?? "");
    if (/unauthorized|auth session|sign in|401/i.test(message)) {
      const soft = buildSessionRefreshShiftBriefing();
      return {
        ...soft,
        assigned_week: options?.week || options?.snapshot?.assigned_week,
        source: "session",
        auth_required: true,
      };
    }
    if (fallback) return fallback;
    if (isShiftBriefingTransportError(err)) {
      throw new Error("Could not load AI briefing");
    }
    throw err;
  }
}

export type InviteSupervisorResult = {
  ok: boolean;
  send_invite?: boolean;
  test_mode?: boolean;
  specialist_id: string;
  username: string;
  name: string;
  department: string;
  invite_token?: string;
  invite_url?: string;
  invite_expires_at?: string;
  temporary_pin?: string;
  phone: string | null;
  status?: "invited" | "active";
  specialist?: Record<string, unknown>;
  sms?:
    | { ok: true; sid: string }
    | { ok: false; skipped: true; reason: string }
    | { ok: false; skipped: false; reason: string };
  sms_preview?: { body: string; sms_link: string };
};

/** @deprecated Prefer issueRosterPairing → POST /api/roster/pair. This path now issues a QR pair URL. */
export async function inviteSupervisor(
  specialist: StoreSpecialist,
  input: {
    specialist_id?: string;
    name?: string;
    username?: string;
    department?: string;
    accessible_departments?: string[];
    phone?: string;
    role?: "Supervisor" | "Associate" | "MasterAdmin";
    floor_title?: string | null;
    send_invite?: boolean;
    test_mode?: boolean;
    store_number?: string;
  }
): Promise<InviteSupervisorResult> {
  const result = await storeOpsFetch<InviteSupervisorResult>(
    "/api/admin/invite-supervisor",
    specialist,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  invalidateRosterCache();
  return result;
}

/** Master Admin: mint a 10-minute QR pairing URL for an existing roster row. */
export async function issueRosterPairing(
  specialist: StoreSpecialist,
  specialistId: string
): Promise<{
  pair_url: string;
  expires_at: string;
  specialist_id: string;
  name: string;
}> {
  const result = await storeOpsFetch<{
    pair_url: string;
    expires_at: string;
    specialist_id: string;
    name: string;
  }>("/api/roster/pair", specialist, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ specialist_id: specialistId }),
  });
  invalidateRosterCache();
  return result;
}

/** Add a roster member for scheduling without sending an app invite. */
export async function createRosterMember(
  specialist: StoreSpecialist,
  input: {
    name: string;
    username?: string;
    department?: string;
    accessible_departments?: string[];
    phone?: string;
    role?: "Supervisor" | "Associate" | "MasterAdmin";
    floor_title?: string | null;
    store_number?: string;
  }
): Promise<InviteSupervisorResult> {
  const result = await storeOpsFetch<InviteSupervisorResult>(
    "/api/roster/members",
    specialist,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  invalidateRosterCache();
  return result;
}

export type BayScanClientResult = import("./ai-bay-scan").BayScanResult & {
  source?: "gemini" | "local";
};

export type BayAuditValidateResult =
  import("./ai-bay-audit").BayAuditVerdictResult & {
    ok: boolean;
    audit_log_id: string;
    source?: "gemini" | "local";
    latency_ms?: number;
  };

/** Multimodal bay audit → rubric verdict + persisted bay_audit_logs row. */
export async function validateBayAudit(
  specialist: StoreSpecialist,
  input: {
    image: string;
    mime_type?: string;
    aisle?: string;
    bay?: number;
    department_id: string;
    department_code?: string;
    rotation_id?: string;
    bay_number?: string;
    image_url?: string;
    allow_local_fallback?: boolean;
  }
): Promise<BayAuditValidateResult> {
  const rawBase64 = String(input.image ?? "")
    .trim()
    .replace(/^data:image\/[\w+.-]+;base64,/i, "");
  return storeOpsFetch<BayAuditValidateResult>(
    "/api/ai/bay-audit/validate",
    specialist,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        image: rawBase64,
        mime_type: input.mime_type || "image/jpeg",
      }),
    }
  );
}

export type SnagTriageClientResult = import("@/lib/ai/contracts/snag-triage").SnagTriageResult & {
  ok: boolean;
  source?: "gemini" | "local";
  dispatch?: {
    dispatched: boolean;
    target: string;
    record_id?: string;
  } | null;
};

/** Parse associate snag report → severity, equipment, dispatch target. */
export async function triageSnagReport(
  specialist: StoreSpecialist,
  input: {
    text: string;
    department_code?: string;
    location_tag?: string;
    store_number?: string;
    dispatch?: boolean;
    rotation_id?: string;
    location_id?: string;
    assigned_week?: string;
    allow_local_fallback?: boolean;
  }
): Promise<SnagTriageClientResult> {
  return storeOpsFetch<SnagTriageClientResult>(
    "/api/ai/snag/triage",
    specialist,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
}

/** Gemini multimodal bay photo → inventory / safety compliance JSON. */
export async function scanBayVisual(
  specialist: StoreSpecialist,
  input: {
    image: string;
    mime_type?: string;
    aisle?: string;
    bay?: number;
    department_code?: string;
    allow_local_fallback?: boolean;
  }
): Promise<BayScanClientResult> {
  const rawBase64 = String(input.image ?? "")
    .trim()
    .replace(/^data:image\/[\w+.-]+;base64,/i, "");
  return storeOpsFetch<BayScanClientResult>(
    "/api/store-ops/ai-bay-scan",
    specialist,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        image: rawBase64,
        mime_type: input.mime_type || "image/jpeg",
      }),
    }
  );
}

/** Master-only fiscal calendar coverage (FS-001A). */
export type FiscalCoverageClient = {
  status: "HEALTHY" | "ATTENTION" | "URGENT" | "EXPIRED";
  operational_date: string;
  current_fiscal_year: number | null;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
  days_remaining: number | null;
  next_fiscal_year: number | null;
  next_fiscal_year_loaded: boolean;
  current_source_type: "COMPANY_PUBLISHED" | "MASTER_ADMIN_DECLARED" | null;
  reason_codes: string[];
  generated_at: string;
  store_timezone?: string;
  iso_rotation_unaffected?: boolean;
};

export async function fetchFiscalCoverage(
  specialist: StoreSpecialist,
  date?: string
): Promise<FiscalCoverageClient> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return storeOpsFetch<FiscalCoverageClient>(
    `/api/admin/fiscal-calendar/coverage${qs}`,
    specialist
  );
}
