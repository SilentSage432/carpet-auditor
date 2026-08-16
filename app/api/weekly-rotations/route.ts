import { NextResponse } from "next/server";
import {
  isDeptFloorActor,
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { resolveScopedDepartmentId, resolveStoreLocationDepartmentIds } from "@/lib/store-ops/department-scope";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { sundayStagingWeekLabel } from "@/lib/store-ops/sunday-schedule";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

const ROTATION_SELECT =
  "id, department_id, location_id, assigned_week, is_completed, completed_at, created_at, store_locations(id, aisle, bay, type, last_completed_at, last_serviced_at, status, cycle_number)";
const ROTATION_SELECT_NO_LAST =
  "id, department_id, location_id, assigned_week, is_completed, completed_at, created_at, store_locations(id, aisle, bay, type, status, cycle_number)";

/**
 * GET /api/weekly-rotations — this week's assignments for the actor's department.
 * Empty / missing assigned_week → smooth empty list (no schema toast).
 */
export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const week = sundayStagingWeekLabel(new Date(), store.timezone) || "";
    if (!week) {
      return NextResponse.json({
        assigned_week: "",
        store_id: null,
        rotations: [],
      });
    }

    const storeId = store.id;

    const url = new URL(request.url);
    const departmentIdParam = url.searchParams.get("department_id");
    const storeIdParam = url.searchParams.get("store_id");

    const scopedStoreId =
      actor.role === "super_admin" && storeIdParam ? storeIdParam : storeId;

    let departmentId: string | null = departmentIdParam;

    if (isDeptFloorActor(actor)) {
      departmentId = await resolveScopedDepartmentId(
        supabase,
        actor,
        storeId,
        departmentIdParam
      );
    }

    const rotations = await fetchWeekRotations(supabase, {
      week,
      storeId: scopedStoreId,
      departmentIds: await resolveStoreLocationDepartmentIds(
        supabase,
        store.id,
        departmentId
      ),
    });

    return NextResponse.json({
      assigned_week: week,
      store_id: scopedStoreId,
      rotations,
    });
    } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[weekly-rotations]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load weekly rotations" },
      { status: 500 }
    );
  }
}

async function fetchWeekRotations(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  opts: {
    week: string;
    storeId: string | null;
    departmentIds: string[] | null;
  }
): Promise<unknown[]> {
  // Prefer store-scoped query; fall back if store_id column is missing.
  const attempts: Array<{ withStoreId: boolean; select: string }> = [
    { withStoreId: true, select: ROTATION_SELECT },
    { withStoreId: true, select: ROTATION_SELECT_NO_LAST },
    { withStoreId: false, select: ROTATION_SELECT },
    { withStoreId: false, select: ROTATION_SELECT_NO_LAST },
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    const { data, error } = await buildQuery(supabase, opts, attempt);
    if (!error) {
      return (data ?? []).filter(
        (row) =>
          row &&
          typeof row === "object" &&
          Boolean((row as { assigned_week?: string | null }).assigned_week)
      );
    }
    lastError = error;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not load weekly_rotations");
}

function buildQuery(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  opts: {
    week: string;
    storeId: string | null;
    departmentIds: string[] | null;
  },
  attempt: { withStoreId: boolean; select: string }
) {
  let query = supabase
    .from("weekly_rotations")
    .select(attempt.select)
    .eq("assigned_week", opts.week)
    .order("created_at", { ascending: true });

  if (attempt.withStoreId && opts.storeId) {
    query = query.eq("store_id", opts.storeId);
  }
  if (opts.departmentIds && opts.departmentIds.length === 1) {
    query = query.eq("department_id", opts.departmentIds[0]);
  } else if (opts.departmentIds && opts.departmentIds.length > 1) {
    query = query.in("department_id", opts.departmentIds);
  }
  return query;
}
