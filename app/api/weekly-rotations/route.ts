import { NextResponse } from "next/server";
import {
  parseStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import { resolveDepartmentIdByCode } from "@/lib/store-ops/rotations";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { isoWeekLabel } from "@/lib/store-ops/week";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * GET /api/weekly-rotations — this week's assignments for the actor's department.
 */
export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(parseStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const week = isoWeekLabel();
    const url = new URL(request.url);
    const departmentIdParam = url.searchParams.get("department_id");
    const storeIdParam = url.searchParams.get("store_id");

    const storeId =
      actor.role === "super_admin" && storeIdParam
        ? storeIdParam
        : store.id;

    let departmentId: string | null = departmentIdParam;

    if (actor.role === "department_supervisor") {
      if (!actor.departmentCode) {
        return NextResponse.json(
          { error: "No department assigned" },
          { status: 403 }
        );
      }
      departmentId = await resolveDepartmentIdByCode(
        supabase,
        actor.departmentCode,
        store.id
      );
      if (!departmentId) {
        return NextResponse.json(
          { error: "Department not found" },
          { status: 404 }
        );
      }
    }

    let query = supabase
      .from("weekly_rotations")
      .select("*, store_locations(*)")
      .eq("assigned_week", week)
      .eq("store_id", storeId)
      .order("created_at", { ascending: true });

    if (departmentId) {
      query = query.eq("department_id", departmentId);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      assigned_week: week,
      store_id: storeId,
      rotations: data ?? [],
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
