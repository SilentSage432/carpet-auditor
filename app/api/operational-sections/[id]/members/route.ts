/**
 * POST   /api/operational-sections/[id]/members — add physical bays
 * DELETE /api/operational-sections/[id]/members — remove physical bays
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
  addOperationalSectionMembers,
  loadOperationalSectionForStore,
  removeOperationalSectionMembers,
} from "@/lib/store-ops/operational-sections";
import { readableError } from "@/lib/store-ops/errors";

type Body = {
  members?: Array<{ department_id: string; aisle: string; bay: number }>;
  /** Ignored — store scope comes from the authenticated actor only. */
  store_id?: string;
};

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const { id } = await context.params;
    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as Body;
    const members = body.members ?? [];
    if (members.length === 0) {
      return NextResponse.json(
        { error: "members array is required" },
        { status: 400 }
      );
    }

    const loaded = await loadOperationalSectionForStore(supabase, {
      section_id: id,
      store_id: store.id,
    });
    if (!loaded.ok) {
      return NextResponse.json(
        { error: loaded.message, code: loaded.code },
        { status: 404 }
      );
    }

    await assertActorCanAccessDepartmentId(
      supabase,
      actor,
      store.id,
      loaded.value.department_id
    );

    const result = await addOperationalSectionMembers(supabase, {
      section_id: id,
      store_id: store.id,
      department_id: loaded.value.department_id,
      members,
      acted_by_specialist_id: actor.specialistId,
    });

    if (!result.ok) {
      const status =
        result.code === "not_found"
          ? 404
          : result.code === "bay_conflict" ||
              result.code === "department_mismatch" ||
              result.code === "section_retired"
            ? 400
            : 500;
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status }
      );
    }

    return NextResponse.json({ ok: true, ...result.value });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to add section members") },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const { id } = await context.params;
    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as Body;
    const members = body.members ?? [];
    if (members.length === 0) {
      return NextResponse.json(
        { error: "members array is required" },
        { status: 400 }
      );
    }

    const loaded = await loadOperationalSectionForStore(supabase, {
      section_id: id,
      store_id: store.id,
    });
    if (!loaded.ok) {
      return NextResponse.json(
        { error: loaded.message, code: loaded.code },
        { status: 404 }
      );
    }

    await assertActorCanAccessDepartmentId(
      supabase,
      actor,
      store.id,
      loaded.value.department_id
    );

    const result = await removeOperationalSectionMembers(supabase, {
      section_id: id,
      store_id: store.id,
      members,
      acted_by_specialist_id: actor.specialistId,
    });

    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : 400;
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status }
      );
    }

    return NextResponse.json({ ok: true, ...result.value });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to remove section members") },
      { status: 500 }
    );
  }
}
