import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { listCompletionAttemptsForRotations } from "@/lib/store-ops/completion-attempt-history";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { readableError } from "@/lib/store-ops/errors";

/**
 * GET /api/store-locations/history?location_id=
 * Super Admin — bay rotation history for Store Map bottom sheet.
 * Optionally attaches completion_attempts per rotation when the history table exists.
 */
export async function GET(request: Request) {
  try {
    const actor = requireSuperAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const locationId = new URL(request.url).searchParams
      .get("location_id")
      ?.trim();
    if (!locationId) {
      return NextResponse.json(
        { error: "location_id is required" },
        { status: 400 }
      );
    }

    const { data: location, error: locError } = await supabase
      .from("store_locations")
      .select("*")
      .eq("id", locationId)
      .eq("store_id", store.id)
      .maybeSingle();

    if (locError) {
      return NextResponse.json(
        { error: readableError(locError, "Could not load location") },
        { status: 500 }
      );
    }
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const { data: rotations, error: rotError } = await supabase
      .from("weekly_rotations")
      .select(
        "id, assigned_week, is_completed, completed_at, created_at, location_id, superseded_at, supersede_source, verification_status, verified_at"
      )
      .eq("location_id", locationId)
      .order("assigned_week", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(48);

    if (rotError) {
      const legacy = await supabase
        .from("weekly_rotations")
        .select(
          "id, assigned_week, is_completed, completed_at, created_at, location_id"
        )
        .eq("location_id", locationId)
        .order("assigned_week", { ascending: false })
        .limit(24);
      if (legacy.error) {
        return NextResponse.json(
          { error: readableError(legacy.error, "Could not load bay history") },
          { status: 500 }
        );
      }
      return NextResponse.json({
        store_id: store.id,
        location,
        rotations: legacy.data ?? [],
        completion_attempt_history_available: false,
      });
    }

    const rotationRows = rotations ?? [];
    const { attempts, unavailable } = await listCompletionAttemptsForRotations(
      supabase,
      rotationRows.map((row) => String((row as { id?: string }).id ?? ""))
    );
    const attemptsByRotation = new Map<string, typeof attempts>();
    for (const attempt of attempts) {
      const list = attemptsByRotation.get(attempt.weekly_rotation_id) ?? [];
      list.push(attempt);
      attemptsByRotation.set(attempt.weekly_rotation_id, list);
    }

    return NextResponse.json({
      store_id: store.id,
      location,
      rotations: rotationRows.map((row) => {
        const id = String((row as { id?: string }).id ?? "");
        return {
          ...row,
          completion_attempts: attemptsByRotation.get(id) ?? [],
        };
      }),
      completion_attempt_history_available: !unavailable,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not load bay history") },
      { status: 500 }
    );
  }
}
