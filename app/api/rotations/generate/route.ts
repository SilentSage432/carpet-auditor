import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import {
  generateWeeklyRotations,
  resolveDepartmentIdByCode,
} from "@/lib/store-ops/rotations";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { notifyDepartmentRotationBatch } from "@/lib/push/dispatch";
import { isWebPushConfigured } from "@/lib/push/vapid";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * POST /api/rotations/generate
 * Body: { department_id: uuid, count: number }
 * Super admin only — picks PENDING bays (auto cycle-reset when exhausted).
 * On success, dispatches Web Push alerts to that department's supervisors.
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
      department_code?: string;
      count?: number;
    };

    let departmentId = body.department_id?.trim() || "";
    if (!departmentId && body.department_code) {
      departmentId =
        (await resolveDepartmentIdByCode(
          supabase,
          body.department_code,
          store.id
        )) ?? "";
    }

    if (!departmentId) {
      return NextResponse.json(
        { error: "department_id is required" },
        { status: 400 }
      );
    }

    const { data: dept, error: deptError } = await supabase
      .from("departments")
      .select("id, store_id, weekly_bay_target, is_active")
      .eq("id", departmentId)
      .eq("store_id", store.id)
      .maybeSingle();

    if (deptError) {
      return NextResponse.json({ error: deptError.message }, { status: 500 });
    }
    if (!dept) {
      return NextResponse.json(
        { error: "Department not found for this store" },
        { status: 404 }
      );
    }
    if (dept.is_active === false) {
      return NextResponse.json(
        {
          error:
            "Department is paused — activate it in Store Map / Settings before generating rotations",
        },
        { status: 400 }
      );
    }

    // Optional override count for Force Draw; otherwise engine reads weekly_bay_target
    const rawCount = body.count;
    const countOverride =
      rawCount != null && Number.isFinite(Number(rawCount)) && Number(rawCount) >= 1
        ? Math.floor(Number(rawCount))
        : null;

    const result = await generateWeeklyRotations(
      supabase,
      departmentId,
      countOverride
    );

    let push = {
      attempted: 0,
      delivered: 0,
      failed: 0,
      removed: 0,
      skipped: !isWebPushConfigured() || result.rotations.length === 0,
    };

    if (isWebPushConfigured() && result.rotations.length > 0) {
      try {
        const dispatch = await notifyDepartmentRotationBatch(supabase, {
          departmentId,
          assignedWeek: result.assigned_week,
          bayCount: result.rotations.length,
        });
        push = { ...dispatch, skipped: false };
      } catch {
        push = { ...push, skipped: false, failed: 1 };
      }
    }

    return NextResponse.json({
      ...result,
      created: result.rotations.length,
      store_id: store.id,
      push,
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
