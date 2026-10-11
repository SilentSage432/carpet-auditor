/**
 * POST /api/walkthroughs/follow-ups — create follow-up (Supervisor/Master)
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
import { createWalkthroughFollowUp } from "@/lib/store-ops/walkthroughs";
import { readableError } from "@/lib/store-ops/errors";

type Body = {
  observation_id?: string;
  action_text?: string;
  responsible_specialist_id?: string | null;
  due_on?: string | null;
};

export async function POST(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as Body;

    const result = await createWalkthroughFollowUp(supabase, {
      store_id: store.id,
      store_number: store.store_number,
      observation_id: String(body.observation_id ?? ""),
      action_text: String(body.action_text ?? ""),
      responsible_specialist_id:
        String(body.responsible_specialist_id ?? "").trim() || null,
      due_on: body.due_on,
      created_by_specialist_id: actor.specialistId,
    });

    if (!result.ok) {
      const status =
        result.code === "missing_relation"
          ? 503
          : result.code === "not_found"
            ? 404
            : result.code === "create_failed"
              ? 500
              : 400;
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
      { error: readableError(err, "Failed to create follow-up") },
      { status: 500 }
    );
  }
}
