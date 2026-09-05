import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";
import { resetStagedWeekRotations } from "@/lib/store-ops/rotations";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { sundayStagingWeekLabel } from "@/lib/store-ops/sunday-schedule";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { parseIsoWeekLabel } from "@/lib/store-ops/week";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * POST /api/admin/rotations/reset
 * Body: { department_id: uuid, week_label?: string (e.g. 2026-W34), include_completed?: boolean }
 * Master Admin — supersedes staged weekly_rotations + clears sunday_bay_assignments for the week.
 */
export async function POST(request: Request) {
  try {
    const actor = requireSuperAdmin(await resolveStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as {
      department_id?: string;
      week_label?: string;
      include_completed?: boolean;
    };

    const departmentId = String(body.department_id ?? "").trim();
    if (!departmentId) {
      return NextResponse.json(
        { error: "department_id is required" },
        { status: 400 }
      );
    }

    const weekLabel =
      String(body.week_label ?? "").trim() ||
      sundayStagingWeekLabel(new Date(), store.timezone);

    try {
      parseIsoWeekLabel(weekLabel);
    } catch {
      return NextResponse.json(
        { error: `Invalid ISO week label: ${weekLabel}` },
        { status: 400 }
      );
    }

    const { data: dept, error: deptError } = await supabase
      .from("departments")
      .select("id, name, code")
      .eq("id", departmentId)
      .eq("store_id", store.id)
      .maybeSingle();

    if (deptError) {
      return NextResponse.json(
        { error: readableError(deptError, "Could not load department") },
        { status: 500 }
      );
    }
    if (!dept) {
      return NextResponse.json(
        { error: "Department not found for this store" },
        { status: 404 }
      );
    }

    const includeCompleted = body.include_completed !== false;
    const reset = await resetStagedWeekRotations(
      supabase,
      departmentId,
      weekLabel,
      {
        store_number: store.store_number,
        includeCompleted,
        supersede_source: "ADMIN_RESET",
        superseded_by: actor.specialistId ?? null,
      }
    );

    return NextResponse.json({
      ok: true,
      audit: {
        store_number: store.store_number,
        department_id: departmentId,
        department_name: dept.name,
        week_label: weekLabel,
        include_completed: includeCompleted,
        ...reset,
      },
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 }
    );
  }
}
