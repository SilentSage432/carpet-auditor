import { NextResponse } from "next/server";
import {
  parseStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import { buildStoreHealthSnapshot } from "@/lib/store-ops/health";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { isoWeekLabel } from "@/lib/store-ops/week";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * GET /api/store-health
 * Current ISO week pace + bottlenecks for store (super admin) or own dept (DS).
 */
export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(parseStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const url = new URL(request.url);
    const week = url.searchParams.get("week")?.trim() || isoWeekLabel();

    const snapshot = await buildStoreHealthSnapshot(supabase, {
      storeId: store.id,
      weekLabel: week,
      departmentCode:
        actor.role === "department_supervisor" ? actor.departmentCode : null,
      departmentId: null,
    });

    return NextResponse.json(snapshot);
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // Soft-fail empty scorecard
    return NextResponse.json({
      assigned_week: isoWeekLabel(),
      store_id: null,
      scope: "store",
      department: null,
      departments: [],
      barriers: [],
      bottleneck_summary: [],
      totals: {
        assigned: 0,
        completed: 0,
        open: 0,
        exceptions: 0,
        completion_pct: 0,
      },
      error: err instanceof Error ? err.message : "Failed to load store health",
    });
  }
}
