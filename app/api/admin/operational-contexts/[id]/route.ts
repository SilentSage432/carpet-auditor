/**
 * PATCH / DELETE /api/admin/operational-contexts/[id]
 * Master Admin — mutate MASTER_ADMIN_DECLARED store-scoped context.
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import {
  deleteMasterDeclaredOperationalContext,
  isOperationalContextKind,
  updateMasterDeclaredOperationalContext,
} from "@/lib/store-ops/operational-context";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { readableError } from "@/lib/store-ops/errors";

type PatchBody = {
  kind?: string;
  title?: string;
  start_date?: string;
  end_date?: string;
  concept_key?: string | null;
  source_reference?: string | null;
  store_id?: string;
};

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = requireSuperAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const { id } = await context.params;
    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as PatchBody;

    if (body.kind != null && !isOperationalContextKind(body.kind)) {
      return NextResponse.json(
        { error: "kind must be SEASON or EVENT" },
        { status: 400 }
      );
    }

    const result = await updateMasterDeclaredOperationalContext(supabase, {
      id,
      store_id: store.id,
      kind: body.kind && isOperationalContextKind(body.kind) ? body.kind : undefined,
      title: body.title,
      start_date: body.start_date,
      end_date: body.end_date,
      concept_key: body.concept_key,
      source_reference: body.source_reference,
    });

    if (!result.ok) {
      const status =
        result.code === "validation_failed"
          ? 400
          : result.code === "not_found"
            ? 404
            : result.code === "forbidden"
              ? 403
              : result.code === "missing_relation"
                ? 503
                : 500;
      return NextResponse.json(
        { error: result.message, details: result.details },
        { status }
      );
    }

    return NextResponse.json({ ok: true, context: result.context });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to update operational context") },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = requireSuperAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const { id } = await context.params;
    const store = await resolveStoreByNumber(supabase, actor.storeNumber);

    const result = await deleteMasterDeclaredOperationalContext(supabase, {
      id,
      store_id: store.id,
    });

    if (!result.ok) {
      const status =
        result.code === "not_found"
          ? 404
          : result.code === "forbidden"
            ? 403
            : result.code === "missing_relation"
              ? 503
              : 500;
      return NextResponse.json({ error: result.message }, { status });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to delete operational context") },
      { status: 500 }
    );
  }
}
