/**
 * POST /api/walkthroughs/observations — create observation (Supervisor/Master)
 * GET  /api/walkthroughs/observations?department_id&aisle&bay — place history
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
import {
  createWalkthroughFollowUp,
  createWalkthroughObservation,
  listWalkthroughPlaceHistory,
  startWalkthroughSession,
  type WalkthroughObservationType,
} from "@/lib/store-ops/walkthroughs";
import { readableError } from "@/lib/store-ops/errors";

export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const url = new URL(request.url);
    const departmentId = String(url.searchParams.get("department_id") ?? "").trim();
    const aisle = String(url.searchParams.get("aisle") ?? "").trim();
    const bayRaw = url.searchParams.get("bay");
    const bay = bayRaw == null ? NaN : Number.parseInt(String(bayRaw), 10);

    if (!departmentId || !aisle || !Number.isFinite(bay)) {
      return NextResponse.json(
        { error: "department_id, aisle, and bay are required" },
        { status: 400 }
      );
    }

    await assertActorCanAccessDepartmentId(
      supabase,
      actor,
      store.id,
      departmentId
    );

    const result = await listWalkthroughPlaceHistory(supabase, {
      store_id: store.id,
      department_id: departmentId,
      aisle,
      bay,
    });

    if (!result.ok) {
      const status =
        result.code === "missing_relation"
          ? 503
          : result.code === "list_failed"
            ? 500
            : 400;
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status }
      );
    }

    return NextResponse.json({ observations: result.value, store_id: store.id });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to load place history") },
      { status: 500 }
    );
  }
}

type CreateBody = {
  session_id?: string | null;
  start_session?: boolean;
  observation_type?: WalkthroughObservationType;
  body?: string;
  associate_specialist_id?: string | null;
  section_id?: string | null;
  department_id?: string | null;
  aisle?: string | null;
  bay?: number | null;
  companion_specialist_id?: string | null;
  focus_section_id?: string | null;
  follow_up?: {
    action_text?: string;
    responsible_specialist_id?: string | null;
    due_on?: string | null;
  } | null;
};

export async function POST(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as CreateBody;
    const departmentId = String(body.department_id ?? "").trim() || null;
    if (departmentId) {
      await assertActorCanAccessDepartmentId(
        supabase,
        actor,
        store.id,
        departmentId
      );
    }

    let sessionId = String(body.session_id ?? "").trim();
    if (!sessionId) {
      const started = await startWalkthroughSession(supabase, {
        store_id: store.id,
        store_number: store.store_number,
        department_id: departmentId,
        companion_specialist_id:
          String(body.companion_specialist_id ?? "").trim() || null,
        focus_section_id:
          String(body.focus_section_id ?? body.section_id ?? "").trim() ||
          null,
        created_by_specialist_id: actor.specialistId,
      });
      if (!started.ok) {
        const status =
          started.code === "missing_relation"
            ? 503
            : started.code === "not_found"
              ? 404
              : started.code === "create_failed"
                ? 500
                : 400;
        return NextResponse.json(
          { error: started.message, code: started.code },
          { status }
        );
      }
      sessionId = started.value.id;
    }

    const result = await createWalkthroughObservation(supabase, {
      store_id: store.id,
      store_number: store.store_number,
      session_id: sessionId,
      observation_type: body.observation_type as WalkthroughObservationType,
      body: String(body.body ?? ""),
      associate_specialist_id:
        String(body.associate_specialist_id ?? "").trim() || null,
      section_id: String(body.section_id ?? "").trim() || null,
      department_id: departmentId,
      aisle: body.aisle,
      bay: body.bay,
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

    let followUp = null;
    const fu = body.follow_up;
    if (fu && String(fu.action_text ?? "").trim()) {
      const fuResult = await createWalkthroughFollowUp(supabase, {
        store_id: store.id,
        store_number: store.store_number,
        observation_id: result.value.id,
        action_text: String(fu.action_text ?? ""),
        responsible_specialist_id:
          String(fu.responsible_specialist_id ?? "").trim() || null,
        due_on: fu.due_on,
        created_by_specialist_id: actor.specialistId,
      });
      if (!fuResult.ok) {
        return NextResponse.json(
          {
            ok: true,
            observation: result.value,
            session_id: sessionId,
            follow_up_error: fuResult.message,
          },
          { status: 207 }
        );
      }
      followUp = fuResult.value;
    }

    return NextResponse.json({
      ok: true,
      observation: result.value,
      session_id: sessionId,
      follow_up: followUp,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to save observation") },
      { status: 500 }
    );
  }
}
