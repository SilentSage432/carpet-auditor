import { NextResponse } from "next/server";
import {
  callGeminiFlashJson,
  GEMINI_TOKEN_BUDGET,
  isGeminiConfigured,
} from "@/lib/ai/gemini";
import {
  isDeptFloorActor,
  resolveStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";
import {
  buildStoreHealthSnapshot,
  enrichSnapshotBayHealth,
  type StoreHealthSnapshot,
} from "@/lib/store-ops/health";
import {
  buildLocalShiftBriefing,
  buildSessionRefreshShiftBriefing,
  buildShiftBriefingPrompt,
  normalizeShiftBriefing,
  SHIFT_BRIEFING_RESPONSE_SCHEMA,
  type ShiftBriefing,
} from "@/lib/store-ops/shift-briefing";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { isoWeekLabel } from "@/lib/store-ops/week";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * POST /api/store-health/ai-summary
 * Zebra Shift Intelligence Briefing from current store health metrics.
 *
 * Auth: Bearer (localStorage session) or cookie session via createSupabaseServerClient.
 * Missing session → soft 200 fallback (prompt to refresh Auth), not a hard 401.
 */
export async function POST(request: Request) {
  try {
    // Ensure cookie-bound server client is available for session forwarding
    // when the request has no Authorization header (SSR / cookie Auth).
    await createSupabaseServerClient();

    const actor = await resolveStoreOpsActor(request);
    if (!actor) {
      const soft = buildSessionRefreshShiftBriefing();
      return NextResponse.json({
        ...soft,
        assigned_week: isoWeekLabel(),
        source: "session" as const,
        auth_required: true,
      });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      week?: string;
      snapshot?: StoreHealthSnapshot;
      telemetry?: StoreHealthSnapshot["telemetry"];
      allow_local_fallback?: boolean;
    };

    const week = body.week?.trim() || isoWeekLabel();
    const store = await resolveStoreByNumber(supabase, actor.storeNumber);

    const snapshot: StoreHealthSnapshot =
      body.snapshot &&
      typeof body.snapshot === "object" &&
      Array.isArray(body.snapshot.departments)
        ? await enrichSnapshotBayHealth(supabase, {
            ...body.snapshot,
            store_id: body.snapshot.store_id || store.id,
            bay_health: body.snapshot.bay_health ?? null,
            telemetry: body.snapshot.telemetry ?? null,
          })
        : await buildStoreHealthSnapshot(supabase, {
            storeId: store.id,
            weekLabel: week,
            departmentCode: isDeptFloorActor(actor)
              ? actor.departmentCode
              : null,
            departmentId: null,
          });

    const telemetry = body.telemetry ?? snapshot.telemetry ?? null;
    const local = buildLocalShiftBriefing(snapshot, telemetry);

    if (!isGeminiConfigured()) {
      return NextResponse.json({
        ...local,
        assigned_week: snapshot.assigned_week,
        source: "local" as const,
      });
    }

    try {
      const prompt = buildShiftBriefingPrompt(snapshot, telemetry);
      const parsed = await callGeminiFlashJson<unknown>(prompt, {
        maxOutputTokens: GEMINI_TOKEN_BUDGET.briefing,
        responseSchema: SHIFT_BRIEFING_RESPONSE_SCHEMA,
        prefer: "object",
      });
      const briefing: ShiftBriefing = normalizeShiftBriefing(parsed, snapshot);
      return NextResponse.json({
        ...briefing,
        assigned_week: snapshot.assigned_week,
        source: "gemini" as const,
      });
    } catch (geminiErr) {
      console.warn("[store-health/ai-summary] Gemini unavailable — local brief", geminiErr);
      return NextResponse.json({
        ...local,
        assigned_week: snapshot.assigned_week,
        source: "local" as const,
      });
    }
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      const soft = buildSessionRefreshShiftBriefing();
      return NextResponse.json({
        ...soft,
        assigned_week: isoWeekLabel(),
        source: "session" as const,
        auth_required: true,
        hint: err.message,
      });
    }
    console.error("[store-health/ai-summary]", err);
    return NextResponse.json(
      {
        error: readableError(
          err,
          "Could not load store health for shift briefing"
        ),
      },
      { status: 400 }
    );
  }
}
