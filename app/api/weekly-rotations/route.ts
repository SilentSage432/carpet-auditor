import { NextResponse } from "next/server";
import {
  parseStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import { resolveDepartmentIdByCode } from "@/lib/store-ops/rotations";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { isoWeekLabel } from "@/lib/store-ops/week";

/**
 * GET /api/weekly-rotations — this week's assignments for the actor's department.
 */
export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(parseStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase is not configured" },
        { status: 503 }
      );
    }

    const week = isoWeekLabel();
    const url = new URL(request.url);
    const departmentIdParam = url.searchParams.get("department_id");

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
        actor.departmentCode
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
