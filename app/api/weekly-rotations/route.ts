import { NextResponse } from "next/server";
import {
  isDeptFloorActor,
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { resolveScopedDepartmentId } from "@/lib/store-ops/department-scope";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { isoWeekLabel } from "@/lib/store-ops/week";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

const ROTATION_SELECT =
  "id, department_id, location_id, assigned_week, is_completed, completed_at, created_at, store_locations(id, aisle, bay, type, last_completed_at, status, cycle_number)";
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

    const week = isoWeekLabel() || "";
    if (!week) {
      return NextResponse.json({
        assigned_week: "",
        store_id: null,
        rotations: [],
      });
    }

    let storeId: string | null = null;
    try {
      const store = await resolveStoreByNumber(supabase, actor.storeNumber);
      storeId = store.id;
    } catch {
      // No store resolved yet — still return an empty week list
      return NextResponse.json({
        assigned_week: week,
        store_id: null,
        rotations: [],
      });
    }

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
      departmentId,
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
    // Soft-fail: zero rotations for the week — UI renders empty state
    return NextResponse.json({
      assigned_week: isoWeekLabel(),
      store_id: null,
      rotations: [],
    });
  }
}

async function fetchWeekRotations(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  opts: {
    week: string;
    storeId: string | null;
    departmentId: string | null;
  }
): Promise<unknown[]> {
  // Prefer store-scoped query; fall back if store_id column is missing.
  const attempts: Array<{ withStoreId: boolean; select: string }> = [
    { withStoreId: true, select: ROTATION_SELECT },
    { withStoreId: true, select: ROTATION_SELECT_NO_LAST },
    { withStoreId: false, select: ROTATION_SELECT },
    { withStoreId: false, select: ROTATION_SELECT_NO_LAST },
  ];

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
  }

  // Schema / empty table — treat as no assignments this week
  return [];
}

function buildQuery(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  opts: {
    week: string;
    storeId: string | null;
    departmentId: string | null;
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
  if (opts.departmentId) {
    query = query.eq("department_id", opts.departmentId);
  }
  return query;
}
