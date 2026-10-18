/**
 * GET /api/roster/lifecycle — active + inactive roster for lifecycle UI.
 * MasterAdmin only (matches canManageTeamRoster).
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";
import { listRosterLifecycleMembers } from "@/lib/store-ops/roster-lifecycle";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";

export async function GET(request: Request) {
  try {
    const actor = requireSuperAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const members = await listRosterLifecycleMembers(
      supabase,
      actor.storeNumber
    );
    const active = members.filter((m) => m.is_active && m.role !== "MasterAdmin");
    const inactive = members.filter(
      (m) => !m.is_active && m.role !== "MasterAdmin"
    );

    return NextResponse.json({
      store_number: actor.storeNumber,
      active,
      inactive,
      active_count: active.length,
      inactive_count: inactive.length,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not load roster lifecycle") },
      { status: 500 }
    );
  }
}
