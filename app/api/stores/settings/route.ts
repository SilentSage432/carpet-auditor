import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { isMissingColumnError, readableError } from "@/lib/store-ops/errors";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import {
  DEFAULT_STORE_TIMEZONE,
  DEFAULT_SUNDAY_AUTO_GENERATE,
  DEFAULT_SUNDAY_AUTO_STAGE_TIME,
  evaluateSundayAutoRun,
  formatSundayStageTimeDisplay,
  normalizeStoreTimezone,
  normalizeSundaySchedule,
  normalizeSundayStageTime,
  sundayStagingWeekLabel,
  type SundayScheduleSettings,
} from "@/lib/store-ops/sunday-schedule";

function scheduleFromStore(store: {
  sunday_auto_generate?: boolean;
  sunday_auto_stage_time?: string;
  timezone?: string;
}): SundayScheduleSettings {
  return normalizeSundaySchedule({
    sunday_auto_generate: store.sunday_auto_generate,
    sunday_auto_stage_time: store.sunday_auto_stage_time,
    timezone: store.timezone,
  });
}

function schedulePayload(store: {
  id: string;
  store_number: string;
  name: string | null;
  sunday_auto_generate?: boolean;
  sunday_auto_stage_time?: string;
  timezone?: string;
}) {
  const settings = scheduleFromStore(store);
  const now = new Date();
  const decision = evaluateSundayAutoRun(settings, now);
  return {
    store_id: store.id,
    store_number: store.store_number,
    name: store.name,
    ...settings,
    auto_stage_time_display: formatSundayStageTimeDisplay(
      settings.sunday_auto_stage_time
    ),
    staging_week: sundayStagingWeekLabel(now, settings.timezone),
    dispatch: {
      would_run: decision.run,
      reason: decision.run ? "Schedule window is open" : decision.reason,
      local_time: decision.localTime,
      timezone: decision.timezone,
      week_label: decision.weekLabel,
    },
  };
}

/**
 * GET /api/stores/settings
 * Supervisor+ — Sunday auto-stage schedule for the actor's store.
 */
export async function GET(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    return NextResponse.json(schedulePayload(store));
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not load store schedule") },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/stores/settings
 * Master Admin — persist Sunday auto-stage time, auto-run toggle, timezone.
 */
export async function PATCH(request: Request) {
  try {
    const actor = requireSuperAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as {
      sunday_auto_generate?: boolean;
      sunday_auto_stage_time?: string;
      timezone?: string;
    };

    const next: SundayScheduleSettings = normalizeSundaySchedule({
      sunday_auto_generate:
        typeof body.sunday_auto_generate === "boolean"
          ? body.sunday_auto_generate
          : store.sunday_auto_generate,
      sunday_auto_stage_time:
        body.sunday_auto_stage_time !== undefined
          ? normalizeSundayStageTime(body.sunday_auto_stage_time)
          : store.sunday_auto_stage_time,
      timezone:
        body.timezone !== undefined
          ? normalizeStoreTimezone(body.timezone)
          : store.timezone,
    });

    const patch = {
      sunday_auto_generate: next.sunday_auto_generate,
      sunday_auto_stage_time: `${next.sunday_auto_stage_time}:00`,
      timezone: next.timezone,
    };

    const { data, error } = await supabase
      .from("stores")
      .update(patch)
      .eq("id", store.id)
      .select("*")
      .single();

    if (error) {
      if (
        isMissingColumnError(error, "sunday_auto_generate") ||
        isMissingColumnError(error, "sunday_auto_stage_time") ||
        isMissingColumnError(error, "timezone")
      ) {
        return NextResponse.json(
          {
            error:
              "Sunday schedule columns are missing. Apply 20260816_sunday_rotation_schedule.sql",
            ...schedulePayload({
              ...store,
              sunday_auto_generate: DEFAULT_SUNDAY_AUTO_GENERATE,
              sunday_auto_stage_time: DEFAULT_SUNDAY_AUTO_STAGE_TIME,
              timezone: DEFAULT_STORE_TIMEZONE,
            }),
          },
          { status: 503 }
        );
      }
      throw new Error(error.message);
    }

    return NextResponse.json(schedulePayload(data));
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not save store schedule") },
      { status: 400 }
    );
  }
}
