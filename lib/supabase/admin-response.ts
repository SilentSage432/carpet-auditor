import { NextResponse } from "next/server";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** Shared 503 when service-role client cannot initialize. */
export function supabaseAdminUnavailableResponse() {
  return NextResponse.json(
    { error: supabaseAdminMissingMessage() },
    { status: 503 }
  );
}

export function requireSupabaseAdmin() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { supabase: null as null, response: supabaseAdminUnavailableResponse() };
  }
  return { supabase, response: null as null };
}
