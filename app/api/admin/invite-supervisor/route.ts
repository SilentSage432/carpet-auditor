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

type InviteBody = {
  /** Re-invite an existing roster member */
  specialist_id?: string;
  name?: string;
  username?: string;
  department?: string;
  accessible_departments?: string[];
  phone?: string;
  role?: "Supervisor" | "Associate" | "MasterAdmin";
  /** When true, generate a hashed token and SMS the /auth/verify link. Default false. */
  send_invite?: boolean;
  /**
   * Staging / Super Admin dry-run: append ?test=1 to invite URL,
   * skip Twilio, and allow /invite/[token] to complete without burning the token.
   */
  test_mode?: boolean;
};

/**
 * POST /api/admin/invite-supervisor
 * Super Admin only. Creates a roster member (default: roster-only, no app token)
 * or issues a hashed one-time /auth/verify SMS invite when send_invite is true.
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

    const created = await createRosterMember({
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
      sendInvite: Boolean(body.send_invite) || Boolean(body.specialist_id),
      testMode: Boolean(body.test_mode),
    });

    if (created.kind === "roster") {
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
    }

    return NextResponse.json({
      ok: true,
      send_invite: true,
      test_mode: Boolean(body.test_mode),
      specialist_id: created.rowId,
      username: created.username,
      name: created.name,
      department: created.department as DepartmentScope,
      invite_token: created.inviteToken,
      invite_url: created.inviteUrl,
      invite_expires_at: created.expires.toISOString(),
      phone: created.phone,
      status: "invited",
      sms: created.sms,
      sms_preview: {
        body: created.smsBody,
        sms_link: created.smsLink,
      },
      specialist: created.saved,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "";
    if (
      message === "name is required" ||
      message === "Phone number is required to send a mobile app invite" ||
      message === "Enter a valid phone number"
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message === "Roster member not found for this store") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error("[invite-supervisor]", err);
    return NextResponse.json(
      { error: readableError(err, "Roster save failed") },
      { status: 500 }
    );
  }
}
