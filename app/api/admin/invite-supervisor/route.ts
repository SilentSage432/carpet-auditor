import { NextResponse } from "next/server";
import {
  buildInviteSmsBody,
  buildInviteUrl,
  buildSmsLink,
  generateInviteToken,
  generateTempPin,
  hashTempPin,
  inviteExpiresAt,
  normalizePhoneE164,
} from "@/lib/invite";
import { suggestUsername } from "@/lib/rbac";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import { readableError } from "@/lib/store-ops/errors";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { sendInviteSms } from "@/lib/twilio-sms";
import { departmentMeta, type DepartmentScope } from "@/lib/types";

type InviteBody = {
  /** Re-invite an existing roster member */
  specialist_id?: string;
  name?: string;
  username?: string;
  department?: string;
  phone?: string;
  role?: "Supervisor" | "Associate" | "MasterAdmin";
  /**
   * Staging / Super Admin dry-run: append &test=1 to invite URL,
   * skip Twilio, and allow /invite to complete without burning the token.
   */
  test_mode?: boolean;
};

/**
 * POST /api/admin/invite-supervisor
 * Super Admin only. Issues temp 6-digit PIN + invite UUID; optional Twilio SMS.
 */
export async function POST(request: Request) {
  try {
    const actor = requireSuperAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const body = (await request.json()) as InviteBody;
    const phone = normalizePhoneE164(body.phone);
    const tempPin = generateTempPin();
    const inviteToken = generateInviteToken();
    const expires = inviteExpiresAt();
    const tempPinHash = hashTempPin(tempPin);

    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
      new URL(request.url).origin;

    let rowId = body.specialist_id?.trim() || "";
    let name = (body.name ?? "").trim();
    let username = (body.username ?? "").trim();
    let department = (body.department ?? "flooring").trim() as DepartmentScope;
    let role: "Supervisor" | "Associate" | "MasterAdmin" =
      body.role === "Associate"
        ? "Associate"
        : body.role === "MasterAdmin"
          ? "MasterAdmin"
          : "Supervisor";

    if (rowId) {
      const { data: existing, error: loadErr } = await supabase
        .from("store_specialists")
        .select("*")
        .eq("id", rowId)
        .eq("store_number", actor.storeNumber)
        .maybeSingle();
      if (loadErr || !existing) {
        return NextResponse.json(
          { error: "Supervisor not found for this store" },
          { status: 404 }
        );
      }
      name = String(existing.name ?? name);
      username = String(existing.username ?? username);
      department = (existing.assigned_department as DepartmentScope) || department;
      role =
        existing.role === "Associate"
          ? "Associate"
          : existing.role === "MasterAdmin"
            ? "MasterAdmin"
            : "Supervisor";
    } else {
      if (!name) {
        return NextResponse.json({ error: "name is required" }, { status: 400 });
      }
      if (role === "MasterAdmin") {
        department = "all";
      }
      if (!username) {
        username = suggestUsername(name, department);
      }
    }

    const testMode = Boolean(body.test_mode);
    const deptMeta = departmentMeta(department);
    const inviteUrl = buildInviteUrl(origin, inviteToken, { test: testMode });
    const smsBody = buildInviteSmsBody({
      storeNumber: actor.storeNumber,
      departmentLabel: deptMeta.label,
      tempPin,
      inviteUrl,
      style: "welcome",
    });

    const invitePatch = {
      invite_token: inviteToken,
      invite_token_expires_at: expires.toISOString(),
      must_change_pin: true,
      must_change_credentials: true,
      temp_pin_hash: tempPinHash,
      pin_code: tempPin,
      phone_number: phone,
      is_active: true,
      store_number: actor.storeNumber,
      name,
      username,
      role,
      assigned_department: role === "MasterAdmin" ? "all" : department,
    };

    let saved: Record<string, unknown> | null = null;

    if (rowId) {
      const { data, error } = await supabase
        .from("store_specialists")
        .update(invitePatch)
        .eq("id", rowId)
        .eq("store_number", actor.storeNumber)
        .select("*")
        .maybeSingle();
      if (error) {
        return NextResponse.json(
          { error: readableError(error, "Could not update invite") },
          { status: 500 }
        );
      }
      saved = data;
    } else {
      const { data, error } = await supabase
        .from("store_specialists")
        .insert(invitePatch)
        .select("*")
        .maybeSingle();
      if (error) {
        return NextResponse.json(
          { error: readableError(error, "Could not create invited supervisor") },
          { status: 500 }
        );
      }
      saved = data;
      rowId = String(data?.id ?? "");
    }

    const sms =
      testMode || !phone
        ? {
            ok: false as const,
            skipped: true as const,
            reason: testMode
              ? "Test Invite Flow — SMS not sent; use Copy Full SMS Text"
              : "No phone number provided — use SMS link preview",
          }
        : await sendInviteSms({ to: phone, body: smsBody });

    const smsLink = buildSmsLink(phone, smsBody);

    return NextResponse.json({
      ok: true,
      test_mode: testMode,
      specialist_id: rowId,
      username,
      name,
      department,
      invite_token: inviteToken,
      invite_url: inviteUrl,
      invite_expires_at: expires.toISOString(),
      temporary_pin: tempPin,
      phone: phone,
      sms,
      sms_preview: {
        body: smsBody,
        sms_link: smsLink,
      },
      specialist: saved,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[invite-supervisor]", err);
    return NextResponse.json(
      { error: readableError(err, "Invite failed") },
      { status: 500 }
    );
  }
}
