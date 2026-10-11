/**
 * PATCH /api/walkthroughs/sessions/[id] — end session (Supervisor/Master)
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
import { endWalkthroughSession } from "@/lib/store-ops/walkthroughs";
import { readableError } from "@/lib/store-ops/errors";

type Body = {
  action?: "end";
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
    const body = (await request.json().catch(() => ({}))) as Body;
    if (body.action && body.action !== "end") {
      return NextResponse.json(
        { error: "Unsupported session action" },
        { status: 400 }
      );
    }

    const result = await endWalkthroughSession(supabase, {
      store_id: store.id,
      session_id: id,
    });

    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : 400;
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status }
      );
    }

    return NextResponse.json({ ok: true, session: result.value });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to update walkthrough session") },
      { status: 500 }
    );
  }
}
