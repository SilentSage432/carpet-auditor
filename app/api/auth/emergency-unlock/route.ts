import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMERGENCY_ADMIN_NAME,
  EMERGENCY_ADMIN_USERNAME,
  EMERGENCY_MASTER_CODE,
  buildEmergencyAdminSpecialist,
} from "@/lib/emergency-access";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { mapRow } from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";

type Body = {
  code?: string;
  store_number?: string;
};

/**
 * Fields that clear lock / temp credential state and grant Master Admin.
 * Does not force a username rewrite (avoids store_specialist_username_key clashes).
 */
const UNLOCK_FLAGS = {
  role: "MasterAdmin",
  is_active: true,
  must_change_credentials: false,
  must_change_pin: false,
  assigned_department: "all",
  invite_token: null,
  invite_token_expires_at: null,
  temp_pin_hash: null,
  pin_code: EMERGENCY_MASTER_CODE,
} as const;

async function findExistingSpecialist(
  supabase: SupabaseClient,
  storeNumber: string
): Promise<Record<string, unknown> | null> {
  // 1) Prefer username match (unique constraint owner).
  {
    let q = supabase
      .from("store_specialists")
      .select("*")
      .ilike("username", EMERGENCY_ADMIN_USERNAME)
      .limit(1);
    if (storeNumber) q = q.eq("store_number", storeNumber);
    const { data } = await q;
    if (data?.[0]) return data[0] as Record<string, unknown>;
  }

  // Global username match if store-scoped miss (constraint may be global).
  {
    const { data } = await supabase
      .from("store_specialists")
      .select("*")
      .ilike("username", EMERGENCY_ADMIN_USERNAME)
      .limit(1);
    if (data?.[0]) return data[0] as Record<string, unknown>;
  }

  // 2) Name match ("Master Admin").
  {
    let q = supabase
      .from("store_specialists")
      .select("*")
      .ilike("name", EMERGENCY_ADMIN_NAME)
      .limit(1);
    if (storeNumber) q = q.eq("store_number", storeNumber);
    const { data } = await q;
    if (data?.[0]) return data[0] as Record<string, unknown>;
  }

  // 3) Existing MasterAdmin role.
  {
    let q = supabase
      .from("store_specialists")
      .select("*")
      .eq("role", "MasterAdmin")
      .order("created_at", { ascending: true })
      .limit(1);
    if (storeNumber) q = q.eq("store_number", storeNumber);
    const { data } = await q;
    if (data?.[0]) return data[0] as Record<string, unknown>;
  }

  {
    const { data } = await supabase
      .from("store_specialists")
      .select("*")
      .eq("role", "MasterAdmin")
      .order("created_at", { ascending: true })
      .limit(1);
    if (data?.[0]) return data[0] as Record<string, unknown>;
  }

  return null;
}

/**
 * POST /api/auth/emergency-unlock
 * Update-only unlock of an existing roster row. Never inserts.
 * Always returns a Master Admin specialist for local session (synced or fallback).
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

    const storeNumber = String(body.store_number ?? "")
      .trim()
      .replace(/[^\d]/g, "");

    const fallback = buildEmergencyAdminSpecialist(storeNumber);

    const { supabase } = requireSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({
        ok: true,
        synced: false,
        specialist: fallback,
        warning: "Service role unavailable — local emergency session only",
      });
    }

    const existing = await findExistingSpecialist(supabase, storeNumber);

    if (!existing?.id) {
      return NextResponse.json({
        ok: true,
        synced: false,
        specialist: fallback,
        warning:
          "No existing roster row matched username/name — local admin session only",
      });
    }

    const updatePayload: Record<string, unknown> = {
      ...UNLOCK_FLAGS,
      store_number: storeNumber || String(existing.store_number ?? ""),
    };

    // Keep the existing username to avoid store_specialist_username_key conflicts.
    const currentUsername = String(existing.username ?? "")
      .trim()
      .toLowerCase();
    if (!currentUsername) {
      updatePayload.username = EMERGENCY_ADMIN_USERNAME;
    }

    const { data: updated, error: updateError } = await supabase
      .from("store_specialists")
      .update(updatePayload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (updateError || !updated) {
      const localFromExisting = mapRow({
        ...existing,
        ...UNLOCK_FLAGS,
        store_number: storeNumber || String(existing.store_number ?? ""),
      }) as StoreSpecialist;
      return NextResponse.json({
        ok: true,
        synced: false,
        specialist: localFromExisting,
        warning: updateError?.message || "Could not update admin profile",
      });
    }

    const specialist = mapRow(
      updated as Record<string, unknown>
    ) as StoreSpecialist;
    return NextResponse.json({ ok: true, synced: true, specialist });
  } catch (err) {
    return NextResponse.json({
      ok: true,
      synced: false,
      specialist: buildEmergencyAdminSpecialist(""),
      warning:
        err instanceof Error ? err.message : "Emergency unlock failed",
    });
  }
}
