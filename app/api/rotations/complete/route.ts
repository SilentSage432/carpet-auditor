import { NextResponse } from "next/server";
import {
  isDeptFloorActor,
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { assertActorCanAccessDepartmentId } from "@/lib/store-ops/department-scope";
import {
  completeWeeklyRotation,
  resolveCompletionAutoVerify,
} from "@/lib/store-ops/rotations";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * POST /api/rotations/complete
 * Body: { rotation_id: uuid, replayed_from_queue?: boolean }
 *
 * Completion authority is human. SNAP-RETIRE-001 removed the Bay Audit Validate
 * model-verdict gate; no automated verdict may block or force a completion.
 *
 * Auto-verify (DS/Master reporting and verifying in one act) requires a first-hand
 * live completion. A completion replayed from the offline queue never auto-verifies,
 * because the server cannot re-authenticate the actor who originally did the work
 * (Art. XIV.3 — reconnection MUST NOT elevate local assumptions).
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

    const body = (await request.json()) as {
      rotation_id?: string;
      replayed_from_queue?: boolean;
    };

    // De-escalation only: this can withhold auto-verify, never grant it. Role still
    // comes exclusively from the server-resolved actor, so a forged value cannot
    // raise privilege.
    const replayedFromQueue = body.replayed_from_queue === true;

    const rotationId = body.rotation_id?.trim();
    if (!rotationId) {
      return NextResponse.json(
        { error: "rotation_id is required" },
        { status: 400 }
      );
    }

    let expectedDepartmentId: string | null = null;

    const { data: rotation, error: rotationError } = await supabase
      .from("weekly_rotations")
      .select("id, department_id, is_completed")
      .eq("id", rotationId)
      .maybeSingle();

    if (rotationError) {
      return NextResponse.json({ error: rotationError.message }, { status: 500 });
    }
    if (!rotation) {
      return NextResponse.json({ error: "Rotation not found" }, { status: 404 });
    }

    if (isDeptFloorActor(actor)) {
      await assertActorCanAccessDepartmentId(
        supabase,
        actor,
        store.id,
        String(rotation.department_id ?? "")
      );
      expectedDepartmentId = String(rotation.department_id ?? "");
    }

    const result = await completeWeeklyRotation(
      supabase,
      rotationId,
      expectedDepartmentId,
      {
        autoVerify: resolveCompletionAutoVerify({
          role: actor.role,
          replayedFromQueue,
        }),
        actorId: actor.specialistId || null,
      }
    );

    return NextResponse.json({
      ok: true,
      ...result,
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
