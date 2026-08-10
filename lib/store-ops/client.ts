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

export async function patchStoreLocation(
  specialist: StoreSpecialist,
  id: string,
  patch: Partial<Pick<StoreLocation, "is_active" | "status">>
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
      aisle: number;
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
          aisle: number;
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
