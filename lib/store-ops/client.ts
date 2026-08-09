/**
 * Browser client helpers for Store Operations APIs.
 */

import type { StoreSpecialist } from "@/lib/types";
import { actorFromSpecialist, storeOpsAuthHeaders } from "./auth";
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
  const actor = actorFromSpecialist(specialist);
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
    [key: string]: unknown;
  };

  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }

  return body as T;
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
  return storeOpsFetch("/api/weekly-rotations", specialist);
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
