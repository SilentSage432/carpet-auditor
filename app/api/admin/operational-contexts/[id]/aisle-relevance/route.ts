/**
 * PUT /api/admin/operational-contexts/[id]/aisle-relevance
 * Master Admin — assign seasonal relevance to every eligible surface in an aisle.
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { isOperationalContextRelevance } from "@/lib/store-ops/operational-context";
import { setAisleSeasonalLocationRelevance } from "@/lib/store-ops/aisle-seasonal-relevance";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { readableError } from "@/lib/store-ops/errors";

type Body = {
  department_id?: string;
  aisle?: string;
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

    const departmentId = String(body.department_id ?? "").trim();
    const aisle = String(body.aisle ?? "").trim();
    if (!departmentId || !aisle) {
      return NextResponse.json(
        { error: "department_id and aisle are required" },
        { status: 400 }
      );
    }

    const rawRelevance = body.relevance;
    let relevance: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "UNSET" = "UNSET";
    if (rawRelevance != null && String(rawRelevance).toUpperCase() !== "UNSET") {
      if (!isOperationalContextRelevance(rawRelevance)) {
        return NextResponse.json(
          { error: "relevance must be UNSET, NONE, LOW, MEDIUM, or HIGH" },
          { status: 400 }
        );
      }
      relevance = rawRelevance;
    }

    const { data: dept } = await supabase
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("store_id", store.id)
      .maybeSingle();
    if (!dept) {
      return NextResponse.json(
        { error: "Department not found for this store" },
        { status: 404 }
      );
    }

    const result = await setAisleSeasonalLocationRelevance(supabase, {
      context_id: id,
      store_id: store.id,
      department_id: departmentId,
      aisle,
      relevance,
      declared_by: actor.userId ?? null,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not update aisle seasonal relevance") },
      { status: 400 }
    );
  }
}
