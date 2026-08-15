import { NextResponse } from "next/server";
import {
  isDeptFloorActor,
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { completeWeeklyRotation } from "@/lib/store-ops/rotations";
import { assertActorCanAccessDepartmentId } from "@/lib/store-ops/department-scope";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * POST /api/rotations/complete
 * Body: { rotation_id: uuid }
 * Marks weekly_rotations complete + store_locations COMPLETED (cool-down).
 */
export async function POST(request: Request) {
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

    const body = (await request.json()) as { rotation_id?: string };
    const rotationId = body.rotation_id?.trim();
    if (!rotationId) {
      return NextResponse.json(
        { error: "rotation_id is required" },
        { status: 400 }
      );
    }

    let expectedDepartmentId: string | null = null;
    if (isDeptFloorActor(actor)) {
      const { data: rotation } = await supabase
        .from("weekly_rotations")
        .select("department_id")
        .eq("id", rotationId)
        .maybeSingle();
      await assertActorCanAccessDepartmentId(
        supabase,
        actor,
        store.id,
        String(rotation?.department_id ?? "")
      );
      expectedDepartmentId = String(rotation?.department_id ?? "");
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
