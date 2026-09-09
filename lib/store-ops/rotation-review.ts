/**
 * DS week-item review — owner: weekly_rotations.verification_status.
 * Cycle cool-down (store_locations.status) stays on the location until DS verifies.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendBackCompletionAttempt,
  verifyCompletionAttempt,
} from "./completion-attempt-history";
import { isMissingColumnError } from "./errors";
import type { StoreLocation, WeeklyRotation } from "./types";

export type ReviewRotationResult = {
  rotation: WeeklyRotation;
  location: StoreLocation | null;
};

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
};

/**
 * Fail closed. The review columns (`verification_status`, `completed_by`,
 * `verified_by`, `verified_at`, `review_note`) all exist in production, so
 * there is no legitimate reason to retry without them — and a retry that drops
 * `verification_status` would let `markLocationCompleted` close the bay with no
 * verification evidence behind it, which is the outcome review exists to
 * prevent (Art. VI.2).
 */
async function updateRotationRow(
  supabase: SupabaseClient,
  rotationId: string,
  patch: Record<string, unknown>
): Promise<WeeklyRotation> {
  const { data, error } = await supabase
    .from("weekly_rotations")
    .update(patch)
    .eq("id", rotationId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as WeeklyRotation;
}

async function markLocationCompleted(
  supabase: SupabaseClient,
  locationId: string,
  now: string
): Promise<StoreLocation> {
  let { data: location, error: locError } = await supabase
    .from("store_locations")
    .update({
      status: "COMPLETED",
      last_completed_at: now,
      carried_over: false,
      updated_at: now,
    })
    .eq("id", locationId)
    .select("*")
    .single();

  if (locError && isMissingColumnError(locError, "carried_over")) {
    const retry = await supabase
      .from("store_locations")
      .update({
        status: "COMPLETED",
        last_completed_at: now,
        updated_at: now,
      })
      .eq("id", locationId)
      .select("*")
      .single();
    location = retry.data;
    locError = retry.error;
  }

  if (locError) throw new Error(locError.message);
  return location as StoreLocation;
}

async function restoreLocationAssigned(
  supabase: SupabaseClient,
  locationId: string,
  now: string
): Promise<StoreLocation | null> {
  const { data, error } = await supabase
    .from("store_locations")
    .update({
      status: "ASSIGNED",
      updated_at: now,
    })
    .eq("id", locationId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as StoreLocation;
}

/**
 * Raw stored review state, deliberately NOT `resolveVerificationStatus`.
 *
 * The resolver infers `VERIFIED_COMPLETE` from `is_completed` when the column is
 * absent, which would make a pre-migration associate submit look already-verified.
 * Transition guards must only act on state the database actually recorded, so an
 * empty value means "two-stage review not represented here" and the guard stands
 * down rather than inventing a transition.
 */
function storedReviewState(row: WeeklyRotation): string {
  return String(row.verification_status ?? "").toUpperCase();
}

async function readLocation(
  supabase: SupabaseClient,
  locationId: string
): Promise<StoreLocation | null> {
  const { data } = await supabase
    .from("store_locations")
    .select("*")
    .eq("id", locationId)
    .maybeSingle();
  return (data as StoreLocation) ?? null;
}

export async function verifyPendingRotation(
  supabase: SupabaseClient,
  rotationId: string,
  actorId?: string | null,
  expectedDepartmentId?: string | null
): Promise<ReviewRotationResult> {
  const { data: rotation, error } = await supabase
    .from("weekly_rotations")
    .select("*")
    .eq("id", rotationId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!rotation) throw new Error("Rotation not found");
  if (
    (rotation as { superseded_at?: string | null }).superseded_at != null &&
    String((rotation as { superseded_at?: string | null }).superseded_at).trim() !==
      ""
  ) {
    throw new Error(
      "Rotation was superseded and is no longer on the active week plan"
    );
  }
  if (
    expectedDepartmentId &&
    rotation.department_id !== expectedDepartmentId
  ) {
    throw new Error("Rotation is outside your assigned department");
  }

  const stored = storedReviewState(rotation as WeeklyRotation);
  if (stored === "VERIFIED_COMPLETE") {
    // Already closed by an authorized verifier — idempotent for double taps and
    // verify_all races. Do not rewrite existing verification provenance.
    return {
      rotation: rotation as WeeklyRotation,
      location: await readLocation(supabase, String(rotation.location_id)),
    };
  }
  if (stored === "PENDING") {
    throw new Error(
      "Bay has not been reported complete — there is nothing to verify"
    );
  }

  const now = new Date().toISOString();
  const updated = await updateRotationRow(supabase, rotationId, {
    is_completed: true,
    completed_at: rotation.completed_at || now,
    verification_status: "VERIFIED_COMPLETE",
    verified_by: actorId ?? null,
    verified_at: now,
    review_note: null,
  });
  await verifyCompletionAttempt(supabase, {
    weeklyRotationId: rotationId,
    reviewedAt: now,
    reviewedBy: actorId ?? null,
  });
  const location = await markLocationCompleted(
    supabase,
    String(rotation.location_id),
    now
  );
  return { rotation: updated, location };
}

export async function sendBackWeeklyRotation(
  supabase: SupabaseClient,
  rotationId: string,
  note: string,
  expectedDepartmentId?: string | null,
  actorId?: string | null
): Promise<ReviewRotationResult> {
  const trimmed = note.trim();
  if (!trimmed) {
    throw new Error("A coaching note is required to send a bay back");
  }

  const { data: rotation, error } = await supabase
    .from("weekly_rotations")
    .select("*")
    .eq("id", rotationId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!rotation) throw new Error("Rotation not found");
  if (
    (rotation as { superseded_at?: string | null }).superseded_at != null &&
    String((rotation as { superseded_at?: string | null }).superseded_at).trim() !==
      ""
  ) {
    throw new Error(
      "Rotation was superseded and is no longer on the active week plan"
    );
  }
  if (
    expectedDepartmentId &&
    rotation.department_id !== expectedDepartmentId
  ) {
    throw new Error("Rotation is outside your assigned department");
  }

  const stored = storedReviewState(rotation as WeeklyRotation);
  if (stored === "VERIFIED_COMPLETE") {
    throw new Error(
      "Bay is already verified complete and cannot be sent back"
    );
  }
  if (stored === "PENDING") {
    throw new Error(
      "Bay has not been reported complete — there is nothing to send back"
    );
  }

  const now = new Date().toISOString();
  const updated = await updateRotationRow(supabase, rotationId, {
    is_completed: false,
    completed_at: null,
    completed_by: null,
    verification_status: "PENDING",
    verified_by: null,
    verified_at: null,
    review_note: trimmed,
  });
  await sendBackCompletionAttempt(supabase, {
    weeklyRotationId: rotationId,
    reviewedAt: now,
    reviewedBy: actorId ?? null,
    reviewNote: trimmed,
  });
  const location = await restoreLocationAssigned(
    supabase,
    String(rotation.location_id),
    now
  );
  return { rotation: updated, location };
}

export async function verifyAllPendingRotations(
  supabase: SupabaseClient,
  input: {
    storeId: string;
    departmentId?: string | null;
    assignedWeek: string;
    actorId?: string | null;
  }
): Promise<{ verified_count: number; department_ids: string[] }> {
  let query = supabase
    .from("weekly_rotations")
    .select("id, department_id")
    .eq("assigned_week", input.assignedWeek)
    .eq("store_id", input.storeId)
    .eq("verification_status", "PENDING_VERIFICATION")
    .is("superseded_at", null);

  if (input.departmentId) {
    query = query.eq("department_id", input.departmentId);
  }

  let { data, error } = await query;
  if (error && isMissingColumnError(error, "superseded_at")) {
    let legacy = supabase
      .from("weekly_rotations")
      .select("id, department_id")
      .eq("assigned_week", input.assignedWeek)
      .eq("store_id", input.storeId)
      .eq("verification_status", "PENDING_VERIFICATION");
    if (input.departmentId) {
      legacy = legacy.eq("department_id", input.departmentId);
    }
    const retry = await legacy;
    data = retry.data;
    error = retry.error;
  }
  if (error) {
    if (isMissingColumnError(error, "verification_status")) {
      return { verified_count: 0, department_ids: [] };
    }
    throw new Error(error.message);
  }

  const rows = data ?? [];
  const departmentIds = [
    ...new Set(
      rows.map((row) => String(row.department_id ?? "")).filter(Boolean)
    ),
  ];

  for (const row of rows) {
    await verifyPendingRotation(
      supabase,
      String(row.id),
      input.actorId,
      input.departmentId ?? null
    );
  }

  return { verified_count: rows.length, department_ids: departmentIds };
}

export async function listPendingVerificationQueue(
  supabase: SupabaseClient,
  input: {
    storeId: string;
    departmentId?: string | null;
    assignedWeek: string;
    assignments?: Record<string, { specialist_name?: string | null }>;
  }
): Promise<VerificationQueueItem[]> {
  let query = supabase
    .from("weekly_rotations")
    .select(
      "id, department_id, location_id, assigned_week, is_completed, completed_at, completed_by, review_note, verification_status, store_locations(id, aisle, bay, type)"
    )
    .eq("assigned_week", input.assignedWeek)
    .eq("store_id", input.storeId)
    .eq("verification_status", "PENDING_VERIFICATION")
    .is("superseded_at", null)
    .order("completed_at", { ascending: true });

  if (input.departmentId) {
    query = query.eq("department_id", input.departmentId);
  }

  let { data, error } = await query;
  if (error && isMissingColumnError(error, "superseded_at")) {
    let legacy = supabase
      .from("weekly_rotations")
      .select(
        "id, department_id, location_id, assigned_week, is_completed, completed_at, completed_by, review_note, verification_status, store_locations(id, aisle, bay, type)"
      )
      .eq("assigned_week", input.assignedWeek)
      .eq("store_id", input.storeId)
      .eq("verification_status", "PENDING_VERIFICATION")
      .order("completed_at", { ascending: true });
    if (input.departmentId) {
      legacy = legacy.eq("department_id", input.departmentId);
    }
    const retry = await legacy;
    data = retry.data;
    error = retry.error;
  }
  if (error) {
    if (isMissingColumnError(error, "verification_status")) {
      return [];
    }
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    department_id: string;
    location_id: string;
    assigned_week: string;
    is_completed: boolean;
    completed_at: string | null;
    completed_by?: string | null;
    review_note?: string | null;
    store_locations:
      | { id: string; aisle: string; bay: number; type: string | null }
      | Array<{ id: string; aisle: string; bay: number; type: string | null }>
      | null;
  }>;
  return rows.map((row) => {
    const locRaw = row.store_locations;
    const loc = Array.isArray(locRaw) ? locRaw[0] ?? null : locRaw;
    return {
      rotation_id: row.id,
      department_id: row.department_id,
      location_id: row.location_id,
      aisle: loc?.aisle ?? "",
      bay: loc?.bay ?? 0,
      type: loc?.type ?? null,
      completed_at: row.completed_at,
      completed_by: row.completed_by ?? null,
      associate_name:
        input.assignments?.[row.id]?.specialist_name ??
        row.completed_by ??
        null,
      review_note: row.review_note ?? null,
      assigned_week: row.assigned_week,
    };
  });
}

export { resolveVerificationStatus } from "./types";
