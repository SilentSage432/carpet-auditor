/**
 * Browser client helpers for Store Operations APIs.
 */

import type { StoreSpecialist } from "@/lib/types";
import { getStoreNumber } from "@/lib/store";
import { actorFromSpecialist, storeOpsAuthHeaders } from "./auth";
import { readableError } from "./errors";
import type {
  BulkGenerateInput,
  Department,
  StoreLocation,
  WeeklyRotationWithLocation,
} from "./types";

async function storeOpsFetch<T>(
  path: string,
  specialist: StoreSpecialist,
  init?: RequestInit
): Promise<T> {
  try {
    const actor = actorFromSpecialist(specialist, getStoreNumber());
    if (!actor) {
      throw new Error("Store Operations access denied for this profile");
    }

    const res = await fetch(path, {
      ...init,
      headers: {
        ...storeOpsAuthHeaders(actor),
        ...(init?.headers ?? {}),
      },
    });

    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      hint?: string;
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

export async function fetchDepartments(
  specialist: StoreSpecialist
): Promise<Department[]> {
  const data = await storeOpsFetch<{ departments: Department[] }>(
    "/api/departments",
    specialist
  );
  return data.departments;
}

export async function fetchStoreLocations(
  specialist: StoreSpecialist,
  departmentId?: string
): Promise<StoreLocation[]> {
  const qs = departmentId
    ? `?department_id=${encodeURIComponent(departmentId)}`
    : "";
  const data = await storeOpsFetch<{ locations: StoreLocation[] }>(
    `/api/store-locations${qs}`,
    specialist
  );
  return data.locations;
}

export async function bulkGenerateLocations(
  specialist: StoreSpecialist,
  input: BulkGenerateInput
): Promise<{ created: number; locations: StoreLocation[] }> {
  return storeOpsFetch("/api/store-locations/bulk", specialist, {
    method: "POST",
    body: JSON.stringify(input),
  });
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

export async function patchStoreLocation(
  specialist: StoreSpecialist,
  id: string,
  patch: Partial<
    Pick<
      StoreLocation,
      "is_active" | "status" | "location_type" | "audit_frequency_days"
    >
  >
): Promise<StoreLocation> {
  const data = await storeOpsFetch<{ location: StoreLocation }>(
    "/api/store-locations",
    specialist,
    {
      method: "PATCH",
      body: JSON.stringify({ id, ...patch }),
    }
  );
  return data.location;
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

export async function fetchThisWeekRotations(
  specialist: StoreSpecialist
): Promise<{
  assigned_week: string;
  rotations: WeeklyRotationWithLocation[];
}> {
  try {
    const data = await storeOpsFetch<{
      assigned_week?: string | null;
      rotations?: WeeklyRotationWithLocation[] | null;
    }>("/api/weekly-rotations", specialist);

    const week = String(data.assigned_week ?? "").trim();
    const rotations = Array.isArray(data.rotations)
      ? data.rotations.filter((r) => Boolean(r?.assigned_week))
      : [];

    return {
      assigned_week: week,
      rotations,
    };
  } catch {
    // Zero assignments / schema soft-fail — empty Zebra list, no red toast
    return {
      assigned_week: "",
      rotations: [],
    };
  }
}

export async function completeRotation(
  specialist: StoreSpecialist,
  rotationId: string
): Promise<void> {
  await storeOpsFetch("/api/rotations/complete", specialist, {
    method: "POST",
    body: JSON.stringify({ rotation_id: rotationId }),
  });
}

export async function generateRotations(
  specialist: StoreSpecialist,
  departmentId: string,
  count: number
): Promise<{
  assigned_week: string;
  cycle_number: number;
  cycle_reset: boolean;
  created: number;
}> {
  return storeOpsFetch("/api/rotations/generate", specialist, {
    method: "POST",
    body: JSON.stringify({ department_id: departmentId, count }),
  });
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
  return data.department;
}

/** Super Admin — add bay(s) to this week's rotation and bump adaptive priority. */
export async function assignLocationsToWeek(
  specialist: StoreSpecialist,
  locationIds: string[],
  departmentId?: string
): Promise<{ assigned_week: string; created: number }> {
  return storeOpsFetch("/api/rotations/assign", specialist, {
    method: "POST",
    body: JSON.stringify({
      location_ids: locationIds,
      ...(departmentId ? { department_id: departmentId } : {}),
    }),
  });
}

export async function fetchShowroomLocations(
  specialist: StoreSpecialist,
  departmentId?: string
): Promise<{ locations: StoreLocation[]; due: StoreLocation[] }> {
  const qs = departmentId
    ? `?department_id=${encodeURIComponent(departmentId)}`
    : "";
  try {
    const data = await storeOpsFetch<{
      locations?: StoreLocation[];
      due?: StoreLocation[];
    }>(`/api/showroom-locations${qs}`, specialist);
    return {
      locations: data.locations ?? [],
      due: data.due ?? [],
    };
  } catch {
    return { locations: [], due: [] };
  }
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
  return storeOpsFetch("/api/rotations/verify", specialist, {
    method: "POST",
    body: JSON.stringify(input),
  });
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
    } | null;
    departments: { id: string; name: string; code: string } | null;
  }>;
}> {
  const qs = week ? `?week=${encodeURIComponent(week)}` : "";
  try {
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
        } | null;
        departments: { id: string; name: string; code: string } | null;
      }>;
    }>(`/api/rotations/exceptions${qs}`, specialist);

    return {
      assigned_week: data.assigned_week ?? "",
      summary: data.summary ?? [],
      exceptions: data.exceptions ?? [],
    };
  } catch {
    // Empty week / no log yet → 0/0 departments verified, 0 exception rows
    return {
      assigned_week: week ?? "",
      summary: [],
      exceptions: [],
    };
  }
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
    open: number;
    exception_count: number;
    completion_pct: number;
  } | null;
  departments: Array<{
    department_id: string;
    department_name: string;
    department_code: string;
    weekly_bay_target: number;
    assigned: number;
    completed: number;
    open: number;
    exception_count: number;
    completion_pct: number;
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
    open: number;
    exceptions: number;
    completion_pct: number;
  };
};

export async function fetchStoreHealth(
  specialist: StoreSpecialist,
  week?: string
): Promise<StoreHealthSnapshotClient> {
  const qs = week ? `?week=${encodeURIComponent(week)}` : "";
  try {
    return await storeOpsFetch<StoreHealthSnapshotClient>(
      `/api/store-health${qs}`,
      specialist
    );
  } catch {
    return {
      assigned_week: week ?? "",
      store_id: null,
      scope: "store",
      department: null,
      departments: [],
      barriers: [],
      bottleneck_summary: [],
      totals: {
        assigned: 0,
        completed: 0,
        open: 0,
        exceptions: 0,
        completion_pct: 0,
      },
    };
  }
}

export type ShiftBriefingClient = {
  headline: string;
  bullets: [string, string, string];
  priority_department: string;
  assigned_week?: string;
  source?: "gemini" | "local";
};

/** Zebra Shift Intelligence Briefing from store health metrics. */
export async function fetchShiftBriefing(
  specialist: StoreSpecialist,
  week?: string
): Promise<ShiftBriefingClient> {
  return storeOpsFetch<ShiftBriefingClient>(
    "/api/store-health/ai-summary",
    specialist,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(week ? { week } : {}),
    }
  );
}

export type InviteSupervisorResult = {
  ok: boolean;
  test_mode?: boolean;
  specialist_id: string;
  username: string;
  name: string;
  department: string;
  invite_token: string;
  invite_url: string;
  invite_expires_at: string;
  temporary_pin: string;
  phone: string | null;
  sms:
    | { ok: true; sid: string }
    | { ok: false; skipped: true; reason: string }
    | { ok: false; skipped: false; reason: string };
  sms_preview: { body: string; sms_link: string };
};

export async function inviteSupervisor(
  specialist: StoreSpecialist,
  input: {
    specialist_id?: string;
    name?: string;
    username?: string;
    department?: string;
    phone?: string;
    role?: "Supervisor" | "Associate" | "MasterAdmin";
    test_mode?: boolean;
  }
): Promise<InviteSupervisorResult> {
  return storeOpsFetch<InviteSupervisorResult>(
    "/api/admin/invite-supervisor",
    specialist,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
}
