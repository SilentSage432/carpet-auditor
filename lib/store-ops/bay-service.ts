/**
 * Walk-the-floor bay service persistence.
 * Inserts bay_service_logs, stamps store_locations.last_serviced_at,
 * and promotes velocity_tier from recent heavy/critical history.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { actorAllowsDepartmentCode, type StoreOpsActor } from "./auth";
import { readableError } from "./errors";
import type {
  BayServiceIntensity,
  BayServiceLog,
  StoreLocation,
  VelocityTier,
} from "./types";
import {
  nextVelocityTier,
  parseBayServiceIntensity,
  parseVelocityTier,
  VELOCITY_AUTO_TIER_WINDOW_DAYS,
} from "./velocity";

export type LogBayServiceInput = {
  locationId: string;
  intensity: BayServiceIntensity;
  notes?: string | null;
};

export type LogBayServiceResult = {
  log: BayServiceLog;
  location: StoreLocation;
  velocity_tier: VelocityTier;
};

export async function logBayService(
  supabase: SupabaseClient,
  actor: StoreOpsActor,
  storeId: string,
  input: LogBayServiceInput
): Promise<LogBayServiceResult> {
  const intensity = parseBayServiceIntensity(input.intensity);
  if (!intensity) {
    throw new Error(
      "intensity must be light_touch, heavy_packdown, or critical_hole"
    );
  }

  const locationId = String(input.locationId ?? "").trim();
  if (!locationId) {
    throw new Error("location_id is required");
  }

  const { data: existing, error: fetchError } = await supabase
    .from("store_locations")
    .select("*")
    .eq("id", locationId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (fetchError) {
    throw new Error(readableError(fetchError, "Could not load store location"));
  }
  if (!existing) {
    throw new Error("Location not found");
  }

  const location = existing as StoreLocation;
  if (actor.role !== "super_admin") {
    let locationCode = String(location.department_code ?? "").trim();
    if (!locationCode) {
      const { data: dept } = await supabase
        .from("departments")
        .select("code")
        .eq("id", location.department_id)
        .maybeSingle();
      locationCode = String(dept?.code ?? "").trim();
    }
    if (!actorAllowsDepartmentCode(actor, locationCode)) {
      throw new Error("Forbidden");
    }
  }

  let departmentCode = String(location.department_code ?? "").trim();
  if (!departmentCode) {
    const { data: dept } = await supabase
      .from("departments")
      .select("code")
      .eq("id", location.department_id)
      .maybeSingle();
    departmentCode = String(dept?.code ?? actor.departmentCode ?? "").trim();
  }
  if (!departmentCode) {
    throw new Error("Department code is required to log bay service");
  }

  const notes = String(input.notes ?? "").trim() || null;
  const servicedBy = actor.specialistId || actor.userId || null;
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: inserted, error: insertError } = await supabase
    .from("bay_service_logs")
    .insert({
      store_id: location.store_id || storeId,
      location_id: location.id,
      department_code: departmentCode,
      serviced_by: servicedBy,
      intensity,
      notes,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    throw new Error(
      readableError(insertError, "Could not write bay service log")
    );
  }

  const since = new Date(
    now.getTime() - VELOCITY_AUTO_TIER_WINDOW_DAYS * 86_400_000
  ).toISOString();

  const { data: recentRows, error: recentError } = await supabase
    .from("bay_service_logs")
    .select("intensity")
    .eq("location_id", location.id)
    .gte("created_at", since);

  if (recentError) {
    throw new Error(
      readableError(recentError, "Could not load recent bay service history")
    );
  }

  const recentIntensities = (recentRows ?? [])
    .map((row) => parseBayServiceIntensity(row.intensity))
    .filter((value): value is BayServiceIntensity => Boolean(value));

  const nextTier = nextVelocityTier(location.velocity_tier, recentIntensities);

  const patch: Record<string, unknown> = {
    last_serviced_at: nowIso,
    updated_at: nowIso,
  };
  if (nextTier !== parseVelocityTier(location.velocity_tier)) {
    patch.velocity_tier = nextTier;
  }

  const { data: updated, error: updateError } = await supabase
    .from("store_locations")
    .update(patch)
    .eq("id", location.id)
    .select("*")
    .single();

  if (updateError || !updated) {
    throw new Error(
      readableError(updateError, "Could not stamp last_serviced_at")
    );
  }

  return {
    log: inserted as BayServiceLog,
    location: updated as StoreLocation,
    velocity_tier: parseVelocityTier(
      (updated as StoreLocation).velocity_tier ?? nextTier
    ),
  };
}
