/**
 * DEPTSYNC-CLEANUP-002 — Guided workspace cleanup composition.
 *
 * Soft-retire aisles (store_locations.is_active=false) and soft-archive
 * associates (is_active=false, status=suspended). Never hard-deletes.
 * Presentation and API routes consume this module; Map/Sunday/engine untouched.
 */

import { normalizeAisle } from "./aisle";
import { physicalBayKey } from "./physical-bay";
import { composeMapAisleIndex } from "./map-aisle-navigation";
import type { Department, StoreLocation } from "./types";
import type { SpecialistRole } from "@/lib/types";
import { specialistHomeDepartment } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CleanupAisleKey = {
  department_id: string;
  aisle: string;
};

export type CleanupAisleInventoryRow = {
  key: string;
  department_id: string;
  department_name: string;
  department_code: string;
  aisle: string;
  label: string;
  active_bay_count: number;
  inactive_bay_count: number;
  active_surface_count: number;
  retirement_status: "active" | "partially_retired" | "retired";
  active_location_ids: string[];
};

export type CleanupAssociateInventoryRow = {
  id: string;
  name: string;
  role: SpecialistRole | string;
  department: string;
  floor_title: string | null;
  is_active: boolean;
  status: string;
  rotation_eligible: boolean;
  protected: boolean;
};

export type CleanupAislePreview = {
  aisles: Array<{
    key: string;
    department_id: string;
    department_name: string;
    aisle: string;
    label: string;
    active_bay_count: number;
    active_surface_count: number;
    section_membership_count: number;
    weekly_rotation_ref_count: number;
    walkthrough_observation_ref_count: number;
    intended_action: "soft_retire_surfaces";
  }>;
  total_active_bays: number;
  total_active_surfaces: number;
  fingerprint: string;
  intended_action: "soft_retire_aisles";
};

export type CleanupAssociatePreview = {
  associates: Array<{
    id: string;
    name: string;
    role: string;
    department: string;
    sunday_assignment_ref_count: number;
    walkthrough_ref_count: number;
    auth_implication: string;
    intended_action: "soft_archive";
  }>;
  fingerprint: string;
  intended_action: "soft_archive_associates";
};

export type CleanupRecordResult = {
  id: string;
  label: string;
  status: "retired" | "archived" | "already_retired" | "already_archived" | "failed" | "review";
  detail?: string;
};

export type CleanupMutationOutcome = {
  ok: boolean;
  partial: boolean;
  results: CleanupRecordResult[];
  succeeded: number;
  failed: number;
  review: number;
};

export function aisleCleanupKey(departmentId: string, aisle: string): string {
  return `${departmentId}:${normalizeAisle(aisle)}`;
}

export function parseCleanupAisleKeys(
  raw: unknown
): { keys: CleanupAisleKey[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { keys: [], error: "Select at least one aisle" };
  }
  const keys: CleanupAisleKey[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { keys: [], error: "Invalid aisle selection" };
    }
    const departmentId = String(
      (item as { department_id?: unknown }).department_id ?? ""
    ).trim();
    const aisle = normalizeAisle((item as { aisle?: unknown }).aisle);
    if (!departmentId || !aisle) {
      return { keys: [], error: "Each aisle needs department_id and aisle" };
    }
    const key = aisleCleanupKey(departmentId, aisle);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push({ department_id: departmentId, aisle });
  }
  if (keys.length === 0) {
    return { keys: [], error: "Select at least one aisle" };
  }
  return { keys };
}

export function parseCleanupSpecialistIds(
  raw: unknown
): { ids: string[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ids: [], error: "Select at least one associate" };
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = String(item ?? "").trim();
    if (!id) {
      return { ids: [], error: "Invalid associate selection" };
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) {
    return { ids: [], error: "Select at least one associate" };
  }
  return { ids };
}

export function isProtectedCleanupRole(role: unknown): boolean {
  return String(role ?? "").trim() === "MasterAdmin";
}

export function composeCleanupAisleInventory(input: {
  locations: StoreLocation[];
  departments: Department[];
}): CleanupAisleInventoryRow[] {
  const deptById = new Map(input.departments.map((d) => [d.id, d]));
  const entries = composeMapAisleIndex({
    locations: input.locations,
    departments: input.departments,
    showRetired: true,
  });

  return entries.map((entry) => {
    const dept = deptById.get(entry.departmentId);
    const activeLocationIds: string[] = [];
    let inactiveSurfaceCount = 0;
    for (const pair of entry.bays) {
      for (const face of [pair.selling, pair.topstock]) {
        if (!face) continue;
        if (face.is_active === false) inactiveSurfaceCount += 1;
        else activeLocationIds.push(face.id);
      }
    }
    let retirementStatus: CleanupAisleInventoryRow["retirement_status"] =
      "active";
    if (activeLocationIds.length === 0) retirementStatus = "retired";
    else if (inactiveSurfaceCount > 0 || entry.inactiveBayCount > 0) {
      retirementStatus = "partially_retired";
    }

    return {
      key: entry.key,
      department_id: entry.departmentId,
      department_name: entry.departmentName,
      department_code: dept?.code ?? "",
      aisle: entry.aisle,
      label:
        entry.aisleCodeCollides
          ? `Aisle ${entry.aisle} · ${entry.departmentName}`
          : `Aisle ${entry.aisle}`,
      active_bay_count: entry.activeBayCount,
      inactive_bay_count: entry.inactiveBayCount,
      active_surface_count: activeLocationIds.length,
      retirement_status: retirementStatus,
      active_location_ids: activeLocationIds,
    };
  });
}

export function composeCleanupAssociateInventory(
  members: Array<{
    id: string;
    name: string;
    role?: SpecialistRole | string | null;
    assigned_department?: string | null;
    home_department?: string | null;
    floor_title?: string | null;
    is_active?: boolean | null;
    status?: string | null;
  }>
): CleanupAssociateInventoryRow[] {
  return members
    .map((m) => {
      const role = String(m.role ?? "Associate");
      const protectedRole = isProtectedCleanupRole(role);
      const active = m.is_active !== false;
      const home = specialistHomeDepartment({
        assigned_department: m.assigned_department,
        home_department: m.home_department,
        role: role as SpecialistRole,
      });
      return {
        id: String(m.id),
        name: String(m.name ?? "").trim() || "Unnamed",
        role,
        department: home,
        floor_title: m.floor_title ?? null,
        is_active: active,
        status: String(m.status ?? (active ? "active" : "suspended")),
        rotation_eligible: active && !protectedRole,
        protected: protectedRole,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function aisleSelectionFingerprint(
  rows: Array<{
    department_id: string;
    aisle: string;
    active_location_ids: string[];
  }>
): string {
  return rows
    .map((row) => {
      const ids = [...row.active_location_ids].sort().join(",");
      return `${aisleCleanupKey(row.department_id, row.aisle)}|${ids}`;
    })
    .sort()
    .join(";");
}

export function associateSelectionFingerprint(
  rows: Array<{ id: string; is_active: boolean; status: string }>
): string {
  return rows
    .map((row) => `${row.id}|${row.is_active ? "1" : "0"}|${row.status}`)
    .sort()
    .join(";");
}

export function summarizeCleanupOutcome(
  results: CleanupRecordResult[]
): CleanupMutationOutcome {
  let succeeded = 0;
  let failed = 0;
  let review = 0;
  for (const row of results) {
    if (
      row.status === "retired" ||
      row.status === "archived" ||
      row.status === "already_retired" ||
      row.status === "already_archived"
    ) {
      succeeded += 1;
    } else if (row.status === "failed") {
      failed += 1;
    } else {
      review += 1;
    }
  }
  return {
    ok: failed === 0 && review === 0,
    partial: succeeded > 0 && (failed > 0 || review > 0),
    results,
    succeeded,
    failed,
    review,
  };
}

type LocationRow = {
  id: string;
  department_id: string;
  aisle: string;
  bay: number;
  type: string;
  is_active: boolean;
  store_id: string;
};

async function loadStoreLocationsForKeys(
  supabase: SupabaseClient,
  storeId: string,
  keys: CleanupAisleKey[]
): Promise<LocationRow[]> {
  const departmentIds = [...new Set(keys.map((k) => k.department_id))];
  const { data, error } = await supabase
    .from("store_locations")
    .select("id, department_id, aisle, bay, type, is_active, store_id")
    .eq("store_id", storeId)
    .in("department_id", departmentIds);

  if (error) {
    throw new Error(error.message || "Could not load locations for cleanup");
  }

  const wanted = new Set(
    keys.map((k) => aisleCleanupKey(k.department_id, k.aisle))
  );
  return ((data ?? []) as LocationRow[]).filter((row) =>
    wanted.has(aisleCleanupKey(row.department_id, normalizeAisle(row.aisle)))
  );
}

export async function buildAisleCleanupPreview(
  supabase: SupabaseClient,
  input: {
    storeId: string;
    departments: Department[];
    keys: CleanupAisleKey[];
  }
): Promise<CleanupAislePreview> {
  const locations = await loadStoreLocationsForKeys(
    supabase,
    input.storeId,
    input.keys
  );
  const deptName = new Map(input.departments.map((d) => [d.id, d.name]));

  const byKey = new Map<string, LocationRow[]>();
  for (const loc of locations) {
    const key = aisleCleanupKey(loc.department_id, loc.aisle);
    const list = byKey.get(key) ?? [];
    list.push(loc);
    byKey.set(key, list);
  }

  const activeIds = locations
    .filter((l) => l.is_active !== false)
    .map((l) => l.id);

  const [rotationCountByLoc, sectionCountByKey, walkCountByKey] =
    await Promise.all([
      countWeeklyRotationsByLocation(supabase, activeIds),
      countSectionMembershipsByAisle(supabase, input.storeId, input.keys),
      countWalkthroughObservationsByAisle(supabase, input.storeId, input.keys),
    ]);

  const aisles: CleanupAislePreview["aisles"] = [];
  const fingerprintRows: Array<{
    department_id: string;
    aisle: string;
    active_location_ids: string[];
  }> = [];

  for (const key of input.keys) {
    const k = aisleCleanupKey(key.department_id, key.aisle);
    const locs = byKey.get(k) ?? [];
    const activeLocs = locs.filter((l) => l.is_active !== false);
    const activeBayKeys = new Set(
      activeLocs.map((l) =>
        physicalBayKey({
          department_id: l.department_id,
          aisle: l.aisle,
          bay: l.bay,
        })
      )
    );
    const activeIdsForAisle = activeLocs.map((l) => l.id);
    fingerprintRows.push({
      department_id: key.department_id,
      aisle: key.aisle,
      active_location_ids: activeIdsForAisle,
    });

    let rotationRefs = 0;
    for (const id of activeIdsForAisle) {
      rotationRefs += rotationCountByLoc.get(id) ?? 0;
    }

    aisles.push({
      key: k,
      department_id: key.department_id,
      department_name: deptName.get(key.department_id) ?? "Unknown",
      aisle: normalizeAisle(key.aisle),
      label: `Aisle ${normalizeAisle(key.aisle)}`,
      active_bay_count: activeBayKeys.size,
      active_surface_count: activeLocs.length,
      section_membership_count: sectionCountByKey.get(k) ?? 0,
      weekly_rotation_ref_count: rotationRefs,
      walkthrough_observation_ref_count: walkCountByKey.get(k) ?? 0,
      intended_action: "soft_retire_surfaces",
    });
  }

  return {
    aisles,
    total_active_bays: aisles.reduce((n, a) => n + a.active_bay_count, 0),
    total_active_surfaces: aisles.reduce(
      (n, a) => n + a.active_surface_count,
      0
    ),
    fingerprint: aisleSelectionFingerprint(fingerprintRows),
    intended_action: "soft_retire_aisles",
  };
}

export async function retireCleanupAisles(
  supabase: SupabaseClient,
  input: {
    storeId: string;
    keys: CleanupAisleKey[];
    fingerprint: string;
  }
): Promise<CleanupMutationOutcome> {
  const locations = await loadStoreLocationsForKeys(
    supabase,
    input.storeId,
    input.keys
  );
  const byKey = new Map<string, LocationRow[]>();
  for (const loc of locations) {
    const key = aisleCleanupKey(loc.department_id, loc.aisle);
    const list = byKey.get(key) ?? [];
    list.push(loc);
    byKey.set(key, list);
  }

  const liveFingerprint = aisleSelectionFingerprint(
    input.keys.map((key) => {
      const locs = byKey.get(aisleCleanupKey(key.department_id, key.aisle)) ?? [];
      return {
        department_id: key.department_id,
        aisle: key.aisle,
        active_location_ids: locs
          .filter((l) => l.is_active !== false)
          .map((l) => l.id),
      };
    })
  );

  if (liveFingerprint !== input.fingerprint) {
    return summarizeCleanupOutcome(
      input.keys.map((key) => ({
        id: aisleCleanupKey(key.department_id, key.aisle),
        label: `Aisle ${normalizeAisle(key.aisle)}`,
        status: "review" as const,
        detail:
          "Selection changed since preview. Refresh the preview and confirm again.",
      }))
    );
  }

  const results: CleanupRecordResult[] = [];

  for (const key of input.keys) {
    const k = aisleCleanupKey(key.department_id, key.aisle);
    const locs = byKey.get(k) ?? [];
    if (locs.length === 0) {
      results.push({
        id: k,
        label: `Aisle ${normalizeAisle(key.aisle)}`,
        status: "review",
        detail: "No locations found for this department + aisle in this store.",
      });
      continue;
    }

    const active = locs.filter((l) => l.is_active !== false);
    if (active.length === 0) {
      results.push({
        id: k,
        label: `Aisle ${normalizeAisle(key.aisle)}`,
        status: "already_retired",
        detail: "All surfaces already inactive.",
      });
      continue;
    }

    const ids = active.map((l) => l.id);
    const { error } = await supabase
      .from("store_locations")
      .update({ is_active: false })
      .eq("store_id", input.storeId)
      .in("id", ids);

    if (error) {
      results.push({
        id: k,
        label: `Aisle ${normalizeAisle(key.aisle)}`,
        status: "failed",
        detail: error.message || "Soft-retire failed",
      });
      continue;
    }

    results.push({
      id: k,
      label: `Aisle ${normalizeAisle(key.aisle)}`,
      status: "retired",
      detail: `Soft-retired ${ids.length} surface row(s). UUIDs preserved.`,
    });
  }

  return summarizeCleanupOutcome(results);
}

export async function buildAssociateCleanupPreview(
  supabase: SupabaseClient,
  input: {
    storeNumber: string;
    specialistIds: string[];
  }
): Promise<
  | { preview: CleanupAssociatePreview }
  | { error: string; status: number; protectedIds?: string[] }
> {
  const { data, error } = await supabase
    .from("store_specialists")
    .select(
      "id, name, role, assigned_department, home_department, floor_title, is_active, status, store_number"
    )
    .eq("store_number", input.storeNumber)
    .in("id", input.specialistIds);

  if (error) {
    return {
      error: error.message || "Could not load associates for cleanup",
      status: 500,
    };
  }

  const rows = (data ?? []) as Array<{
    id: string;
    name: string;
    role: string;
    assigned_department: string | null;
    home_department: string | null;
    floor_title: string | null;
    is_active: boolean;
    status: string;
    store_number: string;
  }>;

  const found = new Map(rows.map((r) => [r.id, r]));
  const missing = input.specialistIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    return {
      error: "One or more associates are not in this store",
      status: 404,
    };
  }

  const protectedIds = rows
    .filter((r) => isProtectedCleanupRole(r.role))
    .map((r) => r.id);
  if (protectedIds.length > 0) {
    return {
      error: "MasterAdmin identity cannot be archived",
      status: 403,
      protectedIds,
    };
  }

  const [sundayCounts, walkCounts] = await Promise.all([
    countSundayAssignmentsBySpecialist(supabase, input.specialistIds),
    countWalkthroughRefsBySpecialist(supabase, input.specialistIds),
  ]);

  const associates = rows.map((row) => {
    const home = specialistHomeDepartment({
      assigned_department: row.assigned_department,
      home_department: row.home_department,
      role: row.role as SpecialistRole,
    });
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      department: home,
      sunday_assignment_ref_count: sundayCounts.get(row.id) ?? 0,
      walkthrough_ref_count: walkCounts.get(row.id) ?? 0,
      auth_implication:
        "Cannot sign in after archive. Credentials unchanged. Historical assignment and walkthrough links remain.",
      intended_action: "soft_archive" as const,
    };
  });

  return {
    preview: {
      associates,
      fingerprint: associateSelectionFingerprint(
        rows.map((r) => ({
          id: r.id,
          is_active: r.is_active !== false,
          status: String(r.status ?? "active"),
        }))
      ),
      intended_action: "soft_archive_associates",
    },
  };
}

/**
 * Soft-archive only. Never hard-deletes.
 * Intentionally avoids the roster remove helper that attempts hard DELETE.
 */
export async function archiveCleanupAssociates(
  supabase: SupabaseClient,
  input: {
    storeNumber: string;
    specialistIds: string[];
    fingerprint: string;
  }
): Promise<CleanupMutationOutcome | { error: string; status: number }> {
  const built = await buildAssociateCleanupPreview(supabase, {
    storeNumber: input.storeNumber,
    specialistIds: input.specialistIds,
  });
  if ("error" in built) {
    return { error: built.error, status: built.status };
  }

  if (built.preview.fingerprint !== input.fingerprint) {
    return summarizeCleanupOutcome(
      input.specialistIds.map((id) => ({
        id,
        label: id,
        status: "review" as const,
        detail:
          "Selection changed since preview. Refresh the preview and confirm again.",
      }))
    );
  }

  const { data, error } = await supabase
    .from("store_specialists")
    .select("id, name, role, is_active, status, store_number")
    .eq("store_number", input.storeNumber)
    .in("id", input.specialistIds);

  if (error) {
    return {
      error: error.message || "Could not load associates for archive",
      status: 500,
    };
  }

  const rows = (data ?? []) as Array<{
    id: string;
    name: string;
    role: string;
    is_active: boolean;
    status: string;
  }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const results: CleanupRecordResult[] = [];

  for (const id of input.specialistIds) {
    const row = byId.get(id);
    if (!row) {
      results.push({
        id,
        label: id,
        status: "review",
        detail: "Associate not found in this store.",
      });
      continue;
    }
    if (isProtectedCleanupRole(row.role)) {
      results.push({
        id,
        label: row.name,
        status: "failed",
        detail: "MasterAdmin identity cannot be archived.",
      });
      continue;
    }
    if (row.is_active === false) {
      results.push({
        id,
        label: row.name,
        status: "already_archived",
        detail: "Already inactive.",
      });
      continue;
    }

    const { error: updateError } = await supabase
      .from("store_specialists")
      .update({ is_active: false, status: "suspended" })
      .eq("id", id)
      .eq("store_number", input.storeNumber)
      .neq("role", "MasterAdmin");

    if (updateError) {
      results.push({
        id,
        label: row.name,
        status: "failed",
        detail: updateError.message || "Soft-archive failed",
      });
      continue;
    }

    results.push({
      id,
      label: row.name,
      status: "archived",
      detail: "Soft-archived (inactive + suspended). Identity preserved.",
    });
  }

  return summarizeCleanupOutcome(results);
}

async function countWeeklyRotationsByLocation(
  supabase: SupabaseClient,
  locationIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (locationIds.length === 0) return counts;
  const { data, error } = await supabase
    .from("weekly_rotations")
    .select("location_id")
    .in("location_id", locationIds);
  if (error || !data) return counts;
  for (const row of data as Array<{ location_id: string }>) {
    const id = String(row.location_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

async function countSectionMembershipsByAisle(
  supabase: SupabaseClient,
  storeId: string,
  keys: CleanupAisleKey[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (keys.length === 0) return counts;
  const departmentIds = [...new Set(keys.map((k) => k.department_id))];
  const { data, error } = await supabase
    .from("operational_section_members")
    .select("department_id, aisle")
    .eq("store_id", storeId)
    .in("department_id", departmentIds);
  if (error || !data) return counts;
  const wanted = new Set(
    keys.map((k) => aisleCleanupKey(k.department_id, k.aisle))
  );
  for (const row of data as Array<{ department_id: string; aisle: string }>) {
    const key = aisleCleanupKey(row.department_id, row.aisle);
    if (!wanted.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function countWalkthroughObservationsByAisle(
  supabase: SupabaseClient,
  storeId: string,
  keys: CleanupAisleKey[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (keys.length === 0) return counts;
  const departmentIds = [...new Set(keys.map((k) => k.department_id))];
  const { data, error } = await supabase
    .from("walkthrough_observations")
    .select("department_id, aisle")
    .eq("store_id", storeId)
    .in("department_id", departmentIds);
  if (error || !data) return counts;
  const wanted = new Set(
    keys.map((k) => aisleCleanupKey(k.department_id, k.aisle))
  );
  for (const row of data as Array<{
    department_id: string | null;
    aisle: string | null;
  }>) {
    if (!row.department_id || !row.aisle) continue;
    const key = aisleCleanupKey(row.department_id, row.aisle);
    if (!wanted.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function countSundayAssignmentsBySpecialist(
  supabase: SupabaseClient,
  specialistIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (specialistIds.length === 0) return counts;
  const { data, error } = await supabase
    .from("sunday_bay_assignments")
    .select("roster_specialist_id")
    .in("roster_specialist_id", specialistIds);
  if (error || !data) return counts;
  for (const row of data as Array<{ roster_specialist_id: string | null }>) {
    const id = String(row.roster_specialist_id ?? "");
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

async function countWalkthroughRefsBySpecialist(
  supabase: SupabaseClient,
  specialistIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (specialistIds.length === 0) return counts;

  const add = (id: string | null | undefined) => {
    const key = String(id ?? "");
    if (!key) return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  const [obs, sessions, followUps] = await Promise.all([
    supabase
      .from("walkthrough_observations")
      .select("associate_specialist_id")
      .in("associate_specialist_id", specialistIds),
    supabase
      .from("walkthrough_sessions")
      .select("companion_specialist_id")
      .in("companion_specialist_id", specialistIds),
    supabase
      .from("walkthrough_follow_ups")
      .select("responsible_specialist_id")
      .in("responsible_specialist_id", specialistIds),
  ]);

  for (const row of (obs.data ?? []) as Array<{
    associate_specialist_id: string | null;
  }>) {
    add(row.associate_specialist_id);
  }
  for (const row of (sessions.data ?? []) as Array<{
    companion_specialist_id: string | null;
  }>) {
    add(row.companion_specialist_id);
  }
  for (const row of (followUps.data ?? []) as Array<{
    responsible_specialist_id: string | null;
  }>) {
    add(row.responsible_specialist_id);
  }
  return counts;
}
