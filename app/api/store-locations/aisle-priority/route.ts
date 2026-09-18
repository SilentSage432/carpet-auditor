import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { setAislePriorityOverride } from "@/lib/store-ops/aisle-priority";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { readableError } from "@/lib/store-ops/errors";

/**
 * POST /api/store-locations/aisle-priority
 * Supervisor+ — set/clear sticky priority_override for an entire aisle.
 *
 * CLEAR semantics (disclosed): clears ALL priority_override flags in the
 * aisle, including individually locked bays (no provenance column exists).
 */
export async function POST(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as {
      department_id?: string;
      aisle?: string;
      priority?: boolean;
    };

    const departmentId = String(body.department_id ?? "").trim();
    const aisle = String(body.aisle ?? "").trim();
    if (!departmentId || !aisle || typeof body.priority !== "boolean") {
      return NextResponse.json(
        { error: "department_id, aisle, and priority (boolean) are required" },
        { status: 400 }
      );
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

    const result = await setAislePriorityOverride(supabase, {
      department_id: departmentId,
      aisle,
      priority: body.priority,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not update aisle priority") },
      { status: 400 }
    );
  }
}
