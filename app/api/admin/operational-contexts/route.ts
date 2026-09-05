/**
 * POST /api/admin/operational-contexts
 * Master Admin — create MASTER_ADMIN_DECLARED store-scoped context.
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
  createMasterDeclaredOperationalContext,
  isOperationalContextKind,
} from "@/lib/store-ops/operational-context";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { readableError } from "@/lib/store-ops/errors";

type Body = {
  kind?: string;
  title?: string;
  start_date?: string;
  end_date?: string;
  concept_key?: string | null;
  source_reference?: string | null;
  /** Ignored — actor store only. */
  store_id?: string;
  /** Ignored — server stamps MASTER_ADMIN_DECLARED. */
  source_type?: string;
  /** Ignored — server stamps actor.userId. */
  declared_by?: string;
};

export async function POST(request: Request) {
  try {
    const actor = requireSuperAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    if (!actor.userId) {
      return NextResponse.json(
        { error: "Master profile id required for declared_by provenance" },
        { status: 403 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as Body;

    if (!isOperationalContextKind(body.kind)) {
      return NextResponse.json(
        { error: "kind must be SEASON or EVENT" },
        { status: 400 }
      );
    }

    const result = await createMasterDeclaredOperationalContext(supabase, {
      kind: body.kind,
      title: String(body.title ?? ""),
      start_date: String(body.start_date ?? ""),
      end_date: String(body.end_date ?? ""),
      concept_key: body.concept_key,
      source_reference: body.source_reference,
      store_id: store.id,
      declared_by: actor.userId,
    });

    if (!result.ok) {
      const status =
        result.code === "validation_failed"
          ? 400
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
      { error: readableError(err, "Failed to create operational context") },
      { status: 500 }
    );
  }
}
