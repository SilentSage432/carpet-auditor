import { NextResponse } from "next/server";
import { EMERGENCY_MASTER_CODE } from "@/lib/emergency-access";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { mapRow } from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";

type Body = {
  code?: string;
  store_number?: string;
};

/**
 * POST /api/auth/emergency-unlock
 * Temporary master code → promote/create Master Admin, clear lock flags, return profile.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const code = String(body.code ?? "").trim();
    if (code !== EMERGENCY_MASTER_CODE) {
      return NextResponse.json(
        { error: "Invalid emergency unlock code" },
        { status: 401 }
      );
    }

    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const storeNumber = String(body.store_number ?? "")
      .trim()
      .replace(/[^\d]/g, "");

    const unlockPatch = {
      role: "MasterAdmin",
      is_active: true,
      must_change_credentials: false,
      must_change_pin: false,
      assigned_department: "all",
      invite_token: null,
      invite_token_expires_at: null,
      temp_pin_hash: null,
      username: "master_admin",
      name: "Master Admin",
      pin_code: EMERGENCY_MASTER_CODE,
    };

    let query = supabase
      .from("store_specialists")
      .select("*")
      .eq("role", "MasterAdmin")
      .order("created_at", { ascending: true })
      .limit(1);

    if (storeNumber) {
      query = query.eq("store_number", storeNumber);
    }

    const { data: existingRows, error: findError } = await query;
    if (findError) {
      return NextResponse.json(
        { error: findError.message || "Could not look up admin profile" },
        { status: 500 }
      );
    }

    let row: Record<string, unknown> | null =
      (existingRows?.[0] as Record<string, unknown> | undefined) ?? null;

    if (!row && storeNumber) {
      const { data: anyAdmin } = await supabase
        .from("store_specialists")
        .select("*")
        .eq("role", "MasterAdmin")
        .order("created_at", { ascending: true })
        .limit(1);
      row = (anyAdmin?.[0] as Record<string, unknown> | undefined) ?? null;
    }

    if (row?.id) {
      const { data: updated, error: updateError } = await supabase
        .from("store_specialists")
        .update({
          ...unlockPatch,
          store_number: storeNumber || String(row.store_number ?? ""),
        })
        .eq("id", row.id)
        .select("*")
        .single();

      if (updateError || !updated) {
        return NextResponse.json(
          { error: updateError?.message || "Could not unlock admin profile" },
          { status: 500 }
        );
      }
      row = updated as Record<string, unknown>;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("store_specialists")
        .insert({
          ...unlockPatch,
          store_number: storeNumber || "0000",
          created_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (insertError || !inserted) {
        return NextResponse.json(
          { error: insertError?.message || "Could not create admin profile" },
          { status: 500 }
        );
      }
      row = inserted as Record<string, unknown>;
    }

    const specialist = mapRow(row) as StoreSpecialist;
    return NextResponse.json({ ok: true, specialist });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Emergency unlock failed",
      },
      { status: 500 }
    );
  }
}
