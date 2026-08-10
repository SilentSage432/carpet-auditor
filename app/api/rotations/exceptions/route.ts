import { NextResponse } from "next/server";
import {
  parseStoreOpsActor,
  requireStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import {
  buildVerificationSummary,
  listRotationExceptions,
} from "@/lib/store-ops/verification";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { isoWeekLabel } from "@/lib/store-ops/week";
import { resolveDepartmentIdByCode } from "@/lib/store-ops/rotations";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";

/**
 * GET /api/rotations/exceptions
 * Super admin: full summary + exception log.
 * Supervisor / Associate: own department exceptions only.
 */
export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(parseStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const url = new URL(request.url);
    const week = url.searchParams.get("week")?.trim() || isoWeekLabel();

    if (actor.role === "super_admin") {
      requireSuperAdmin(actor);
      const [summary, exceptions] = await Promise.all([
        buildVerificationSummary(supabase, week),
        listRotationExceptions(supabase, { assignedWeek: week, limit: 300 }),
      ]);
      return NextResponse.json({
        assigned_week: week,
        store_id: store.id,
        summary,
        exceptions: exceptions ?? [],
      });
    }

    if (!actor.departmentCode) {
      return NextResponse.json(
        { error: "No department assigned" },
        { status: 403 }
      );
    }
    const deptId = await resolveDepartmentIdByCode(
      supabase,
      actor.departmentCode,
      store.id
    );
    if (!deptId) {
      return NextResponse.json(
        { error: "Department not found" },
        { status: 404 }
      );
    }

    const exceptions = await listRotationExceptions(supabase, {
      assignedWeek: week,
      departmentId: deptId,
      limit: 100,
    });

    return NextResponse.json({
      assigned_week: week,
      store_id: store.id,
      summary: [],
      exceptions: exceptions ?? [],
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load exceptions" },
      { status: 500 }
    );
  }
}
