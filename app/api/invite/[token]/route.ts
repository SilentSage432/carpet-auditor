import { NextResponse } from "next/server";
import {
  isInviteExpired,
  isInviteHarnessMode,
  verifyTempPinHash,
} from "@/lib/invite";
import { readableError } from "@/lib/store-ops/errors";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { departmentMeta, type DepartmentScope } from "@/lib/types";

type Ctx = { params: Promise<{ token: string }> };

function publicInviteView(row: Record<string, unknown>) {
  const dept = (row.assigned_department as DepartmentScope) || "flooring";
  return {
    specialist_id: String(row.id),
    name: String(row.name ?? ""),
    username: row.username ? String(row.username) : null,
    store_number: String(row.store_number ?? ""),
    department: dept,
    department_label: departmentMeta(dept).label,
    must_change_pin: Boolean(row.must_change_pin ?? row.must_change_credentials),
    invite_expires_at: row.invite_token_expires_at
      ? String(row.invite_token_expires_at)
      : null,
    expired: isInviteExpired(
      row.invite_token_expires_at
        ? String(row.invite_token_expires_at)
        : null
    ),
  };
}

function logInviteDev(message: string, extra?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.info(`[invite] ${message}`, extra ?? "");
}

async function loadByToken(token: string) {
  const { supabase, response } = requireSupabaseAdmin();
  if (!supabase) return { supabase: null, response, row: null };

  const { data, error } = await supabase
    .from("store_specialists")
    .select("*")
    .eq("invite_token", token)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    return {
      supabase,
      response: NextResponse.json(
        { error: readableError(error, "Could not load invite") },
        { status: 500 }
      ),
      row: null,
    };
  }
  if (!data) {
    return {
      supabase,
      response: NextResponse.json({ error: "Invite not found" }, { status: 404 }),
      row: null,
    };
  }
  return { supabase, response: null as NextResponse | null, row: data as Record<string, unknown> };
}

/** GET /api/invite/[token] — public safe preview for onboarding UI. */
export async function GET(request: Request, ctx: Ctx) {
  const { token: raw } = await ctx.params;
  const token = decodeURIComponent(raw || "").trim();
  if (!token) {
    return NextResponse.json({ error: "Missing invite token" }, { status: 400 });
  }

  const testFlag = new URL(request.url).searchParams.get("test");
  const loaded = await loadByToken(token);
  if (loaded.response) return loaded.response;
  if (!loaded.row) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  const harness = isInviteHarnessMode(testFlag);
  if (harness) {
    logInviteDev("Token Validated", {
      specialist_id: loaded.row.id,
      test: Boolean(testFlag),
    });
  }

  return NextResponse.json({
    invite: publicInviteView(loaded.row),
    test_mode: harness && Boolean(testFlag),
  });
}

/**
 * POST /api/invite/[token]
 * body.action = "verify" | "complete"
 * body.dry_run / test = true → staging harness: do not burn invite token
 */
export async function POST(request: Request, ctx: Ctx) {
  const { token: raw } = await ctx.params;
  const token = decodeURIComponent(raw || "").trim();
  if (!token) {
    return NextResponse.json({ error: "Missing invite token" }, { status: 400 });
  }

  const loaded = await loadByToken(token);
  if (loaded.response) return loaded.response;
  const row = loaded.row;
  const supabase = loaded.supabase;
  if (!row || !supabase) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  if (isInviteExpired(String(row.invite_token_expires_at ?? ""))) {
    return NextResponse.json(
      { error: "This invite link has expired. Ask Master Admin to resend." },
      { status: 410 }
    );
  }

  const body = (await request.json()) as {
    action?: string;
    temp_pin?: string;
    new_pin?: string;
    dry_run?: boolean;
    test?: boolean;
  };
  const action = body.action === "complete" ? "complete" : "verify";
  const tempPin = String(body.temp_pin ?? "").trim();
  const dryRun = isInviteHarnessMode(body.dry_run || body.test);

  if (!/^\d{6}$/.test(tempPin)) {
    return NextResponse.json(
      { error: "Temporary PIN must be exactly 6 digits" },
      { status: 400 }
    );
  }

  const hashOk = verifyTempPinHash(tempPin, String(row.temp_pin_hash ?? ""));
  const pinOk = String(row.pin_code ?? "") === tempPin;
  if (!hashOk && !pinOk) {
    return NextResponse.json({ error: "Incorrect temporary PIN" }, { status: 401 });
  }

  if (action === "verify") {
    if (dryRun || process.env.NODE_ENV !== "production") {
      logInviteDev("Token Validated", {
        action: "verify",
        dry_run: dryRun,
        specialist_id: row.id,
      });
    }
    return NextResponse.json({
      ok: true,
      invite: publicInviteView(row),
      must_change_pin: Boolean(row.must_change_pin ?? true),
      dry_run: dryRun,
    });
  }

  const newPin = String(body.new_pin ?? "").trim();
  if (!/^\d{4,8}$/.test(newPin)) {
    return NextResponse.json(
      { error: "New PIN must be 4–8 digits" },
      { status: 400 }
    );
  }
  if (newPin === tempPin) {
    return NextResponse.json(
      { error: "Choose a new PIN different from the temporary invite PIN" },
      { status: 400 }
    );
  }

  // Staging dry-run: validate flow without burning invite_token / temp PIN.
  if (dryRun) {
    logInviteDev("PIN Reset Success", {
      dry_run: true,
      specialist_id: row.id,
      note: "Invite token preserved for repeated harness runs",
    });
    return NextResponse.json({
      ok: true,
      dry_run: true,
      specialist: {
        id: String(row.id),
        store_number: String(row.store_number ?? ""),
        name: String(row.name ?? ""),
        role: row.role,
        pin_code: newPin,
        username: row.username ? String(row.username) : null,
        assigned_department: row.assigned_department,
        must_change_credentials: false,
        must_change_pin: false,
        is_active: row.is_active !== false,
        created_at: String(row.created_at ?? new Date().toISOString()),
      },
    });
  }

  const { data: updated, error } = await supabase
    .from("store_specialists")
    .update({
      pin_code: newPin,
      must_change_pin: false,
      must_change_credentials: false,
      temp_pin_hash: null,
      invite_token: null,
      invite_token_expires_at: null,
    })
    .eq("id", row.id)
    .eq("invite_token", token)
    .select("*")
    .maybeSingle();

  if (error || !updated) {
    return NextResponse.json(
      { error: readableError(error, "Could not save new PIN") },
      { status: 500 }
    );
  }

  if (process.env.NODE_ENV !== "production") {
    logInviteDev("PIN Reset Success", { specialist_id: updated.id });
  }

  return NextResponse.json({
    ok: true,
    dry_run: false,
    specialist: {
      id: String(updated.id),
      store_number: String(updated.store_number ?? ""),
      name: String(updated.name ?? ""),
      role: updated.role,
      pin_code: newPin,
      username: updated.username ? String(updated.username) : null,
      assigned_department: updated.assigned_department,
      must_change_credentials: false,
      must_change_pin: false,
      is_active: updated.is_active !== false,
      created_at: String(updated.created_at ?? new Date().toISOString()),
    },
  });
}
