import { NextResponse } from "next/server";
import { createRosterMember } from "@/lib/onboarding/create-roster-member";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import type { DepartmentScope } from "@/lib/types";

type RosterMemberBody = {
  name?: string;
  username?: string;
  department?: string;
  accessible_departments?: string[];
  phone?: string;
  role?: "Supervisor" | "Associate" | "MasterAdmin";
  floor_title?: string | null;
  store_number?: string;
};

/**
 * POST /api/roster/members
 * Canonical roster-only insert into `store_specialists` (same table the
 * department accordions read). Does not mint invite tokens or Auth users.
 * Device pairing is POST /api/roster/pair (QR, no SMS).
 */
export async function POST(request: Request) {
  try {
    const actor = requireSuperAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const body = (await request.json()) as RosterMemberBody;
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
      new URL(request.url).origin;

    const created = await createRosterMember({
      supabase,
      storeNumber: actor.storeNumber,
      clientStoreNumber: body.store_number,
      origin,
      name: body.name,
      username: body.username,
      department: body.department,
      accessible_departments: body.accessible_departments,
      phone: body.phone,
      role: body.role,
      floor_title: body.floor_title,
      sendInvite: false,
    });

    if (created.kind !== "roster") {
      return NextResponse.json(
        { error: "Roster-only create returned an invite result" },
        { status: 500 }
      );
    }
    if (!created.rowId) {
      console.error("Roster Insert Failed:", {
        reason: "empty_row_id",
        name: created.name,
      });
      return NextResponse.json(
        { error: "Roster Insert Failed: 0 rows were inserted" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      send_invite: false,
      specialist_id: created.rowId,
      username: created.username,
      name: created.name,
      department: created.department as DepartmentScope,
      phone: created.phone,
      status: "active",
      specialist: created.saved,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "";
    if (
      message === "name is required" ||
      message === "Enter a valid phone number" ||
      message === "store_number is required"
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[roster/members]", err);
    console.error("Roster Insert Failed:", err);
    return NextResponse.json(
      { error: readableError(err, "Roster save failed") },
      { status: 500 }
    );
  }
}
