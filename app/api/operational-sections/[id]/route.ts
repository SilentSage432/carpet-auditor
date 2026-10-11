/**
 * PATCH  /api/operational-sections/[id] — rename / owner / description / lifecycle
 * DELETE /api/operational-sections/[id] — soft-retire (default cleanup)
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
  loadOperationalSectionForStore,
  reactivateOperationalSection,
  retireOperationalSection,
  updateOperationalSection,
} from "@/lib/store-ops/operational-sections";
import { readableError } from "@/lib/store-ops/errors";

type PatchBody = {
  name?: string;
  description?: string | null;
  primary_owner_specialist_id?: string | null;
  /** soft lifecycle */
  action?: "retire" | "reactivate";
};

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const { id } = await context.params;
    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as PatchBody;

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

    if (body.action === "retire") {
      const result = await retireOperationalSection(supabase, {
        section_id: id,
        store_id: store.id,
        acted_by_specialist_id: actor.specialistId,
      });
      if (!result.ok) {
        return NextResponse.json(
          { error: result.message, code: result.code },
          { status: result.code === "not_found" ? 404 : 400 }
        );
      }
      return NextResponse.json({ ok: true, section: result.value });
    }

    if (body.action === "reactivate") {
      const result = await reactivateOperationalSection(supabase, {
        section_id: id,
        store_id: store.id,
        acted_by_specialist_id: actor.specialistId,
      });
      if (!result.ok) {
        return NextResponse.json(
          { error: result.message, code: result.code },
          { status: result.code === "not_found" ? 404 : 400 }
        );
      }
      return NextResponse.json({ ok: true, section: result.value });
    }

    const result = await updateOperationalSection(supabase, {
      section_id: id,
      store_id: store.id,
      name: body.name,
      description: body.description,
      primary_owner_specialist_id: body.primary_owner_specialist_id,
      acted_by_specialist_id: actor.specialistId,
    });

    if (!result.ok) {
      const status =
        result.code === "not_found"
          ? 404
          : result.code === "validation_failed" ||
              result.code === "duplicate_name"
            ? 400
            : 500;
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status }
      );
    }

    return NextResponse.json({ ok: true, section: result.value });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to update operational section") },
      { status: 500 }
    );
  }
}

/** Soft-retire — never hard-deletes section history. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const { id } = await context.params;
    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
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
    const result = await retireOperationalSection(supabase, {
      section_id: id,
      store_id: store.id,
      acted_by_specialist_id: actor.specialistId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status: result.code === "not_found" ? 404 : 400 }
      );
    }
    return NextResponse.json({ ok: true, section: result.value });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to retire operational section") },
      { status: 500 }
    );
  }
}
