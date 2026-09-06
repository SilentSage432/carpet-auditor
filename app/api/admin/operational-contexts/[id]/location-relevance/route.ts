/**
 * PUT /api/admin/operational-contexts/[id]/location-relevance
 * Master Admin — set or clear location seasonal relevance (null = UNSET).
 * Does not mutate store_locations priority / velocity fields.
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
  isOperationalContextRelevance,
  setOperationalContextLocationRelevance,
} from "@/lib/store-ops/operational-context";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { readableError } from "@/lib/store-ops/errors";

type Body = {
  location_id?: string;
  /** null / "UNSET" clears the row. */
  relevance?: string | null;
};

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  try {
    const actor = requireSuperAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const { id } = await context.params;
    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as Body;

    const rawRelevance = body.relevance;
    let relevance: "NONE" | "LOW" | "MEDIUM" | "HIGH" | null = null;
    if (rawRelevance != null && String(rawRelevance).toUpperCase() !== "UNSET") {
      if (!isOperationalContextRelevance(rawRelevance)) {
        return NextResponse.json(
          { error: "relevance must be UNSET, NONE, LOW, MEDIUM, or HIGH" },
          { status: 400 }
        );
      }
      relevance = rawRelevance;
    }

    const result = await setOperationalContextLocationRelevance(supabase, {
      context_id: id,
      store_id: store.id,
      location_id: String(body.location_id ?? ""),
      relevance,
      declared_by: actor.userId ?? null,
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
      return NextResponse.json({ error: result.message }, { status });
    }

    return NextResponse.json({
      ok: true,
      relevance: result.relevance,
      location_relevance: result.relevance?.relevance ?? null,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to update location relevance") },
      { status: 500 }
    );
  }
}
