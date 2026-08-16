import { NextResponse } from "next/server";
import { issueRosterInvite } from "@/lib/onboarding/roster-invite";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import type { DepartmentScope } from "@/lib/types";

type InviteBody = {
  /** Re-invite an existing roster member */
  specialist_id?: string;
  name?: string;
  username?: string;
  department?: string;
  accessible_departments?: string[];
  phone?: string;
  role?: "Supervisor" | "Associate" | "MasterAdmin";
  /**
   * Staging / Super Admin dry-run: append ?test=1 to invite URL,
   * skip Twilio, and allow /invite/[token] to complete without burning the token.
   */
  test_mode?: boolean;
};

/**
 * POST /api/admin/invite-supervisor
 * Super Admin only. Issues a hashed one-time /auth/verify token and SMS link.
 */
export async function POST(request: Request) {
  try {
    const actor = requireSuperAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const body = (await request.json()) as InviteBody;
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
      new URL(request.url).origin;

    const issued = await issueRosterInvite({
      supabase,
      storeNumber: actor.storeNumber,
      origin,
      specialistId: body.specialist_id,
      name: body.name,
      username: body.username,
      department: body.department,
      accessible_departments: body.accessible_departments,
      phone: body.phone,
      role: body.role,
      testMode: Boolean(body.test_mode),
    });

    return NextResponse.json({
      ok: true,
      test_mode: Boolean(body.test_mode),
      specialist_id: issued.rowId,
      username: issued.username,
      name: issued.name,
      department: issued.department as DepartmentScope,
      invite_token: issued.inviteToken,
      invite_url: issued.inviteUrl,
      invite_expires_at: issued.expires.toISOString(),
      phone: issued.phone,
      status: "invited",
      sms: issued.sms,
      sms_preview: {
        body: issued.smsBody,
        sms_link: issued.smsLink,
      },
      specialist: issued.saved,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "";
    if (message === "name is required") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message === "Roster member not found for this store") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error("[invite-supervisor]", err);
    return NextResponse.json(
      { error: readableError(err, "Invite failed") },
      { status: 500 }
    );
  }
}
