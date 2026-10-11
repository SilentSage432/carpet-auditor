/**
 * PATCH /api/walkthroughs/follow-ups/[id] — complete follow-up (Supervisor/Master)
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSupervisorOrAdmin,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { completeWalkthroughFollowUp } from "@/lib/store-ops/walkthroughs";
import { readableError } from "@/lib/store-ops/errors";

type Body = {
  action?: "complete";
  completion_evidence?: string | null;
  resolution_notes?: string | null;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const { id } = await context.params;
    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as Body;
    if (body.action && body.action !== "complete") {
      return NextResponse.json(
        { error: "Unsupported follow-up action" },
        { status: 400 }
      );
    }

    const result = await completeWalkthroughFollowUp(supabase, {
      store_id: store.id,
      follow_up_id: id,
      completion_evidence: body.completion_evidence,
      resolution_notes: body.resolution_notes,
      completed_by_specialist_id: actor.specialistId,
    });

    if (!result.ok) {
      const status =
        result.code === "not_found"
          ? 404
          : result.code === "invalid"
            ? 400
            : 500;
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status }
      );
    }

    return NextResponse.json({ ok: true, follow_up: result.value });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to update follow-up") },
      { status: 500 }
    );
  }
}
