import { NextResponse } from "next/server";
import {
  parseStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import {
  completeWeeklyRotation,
  resolveDepartmentIdByCode,
} from "@/lib/store-ops/rotations";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * POST /api/rotations/complete
 * Body: { rotation_id: uuid }
 * Marks weekly_rotations complete + store_locations COMPLETED (cool-down).
 */
export async function POST(request: Request) {
  try {
    const actor = requireStoreOpsActor(parseStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const body = (await request.json()) as { rotation_id?: string };
    const rotationId = body.rotation_id?.trim();
    if (!rotationId) {
      return NextResponse.json(
        { error: "rotation_id is required" },
        { status: 400 }
      );
    }

    let expectedDepartmentId: string | null = null;
    if (actor.role === "department_supervisor") {
      if (!actor.departmentCode) {
        return NextResponse.json(
          { error: "No department assigned" },
          { status: 403 }
        );
      }
      expectedDepartmentId = await resolveDepartmentIdByCode(
        supabase,
        actor.departmentCode
      );
      if (!expectedDepartmentId) {
        return NextResponse.json(
          { error: "Department not found" },
          { status: 404 }
        );
      }
    }

    const result = await completeWeeklyRotation(
      supabase,
      rotationId,
      expectedDepartmentId
    );

    return NextResponse.json(result);
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
