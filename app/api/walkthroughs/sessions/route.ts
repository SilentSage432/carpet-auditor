/**
 * POST /api/walkthroughs/sessions — start walkthrough (Supervisor/Master)
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
import { assertActorCanAccessDepartmentId } from "@/lib/store-ops/department-scope";
import { ensureActiveWalkthroughSession } from "@/lib/store-ops/walkthroughs";
import { readableError } from "@/lib/store-ops/errors";

type Body = {
  department_id?: string | null;
  companion_specialist_id?: string | null;
  focus_section_id?: string | null;
  notes?: string | null;
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
    const departmentId = String(body.department_id ?? "").trim() || null;
    if (departmentId) {
      await assertActorCanAccessDepartmentId(
        supabase,
        actor,
        store.id,
        departmentId
      );
    }

    const result = await ensureActiveWalkthroughSession(supabase, {
      store_id: store.id,
      store_number: store.store_number,
      department_id: departmentId,
      companion_specialist_id:
        String(body.companion_specialist_id ?? "").trim() || null,
      focus_section_id: String(body.focus_section_id ?? "").trim() || null,
      notes: body.notes,
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

    return NextResponse.json({
      ok: true,
      session: result.value,
      created: Boolean(result.created),
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to start walkthrough") },
      { status: 500 }
    );
  }
}
