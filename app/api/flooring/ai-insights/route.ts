import { NextResponse } from "next/server";
import {
  callGeminiFlashJson,
  GEMINI_TOKEN_BUDGET,
  isGeminiConfigured,
} from "@/lib/ai/gemini";
import {
  buildFlooringInsightsPrompt,
  buildLocalFlooringInsights,
  compactFlooringInsightsForPrompt,
  FLOORING_INSIGHTS_RESPONSE_SCHEMA,
  mergeNarratedFlooringInsights,
  type FlooringAiInsights,
} from "@/lib/flooring/ai-insights";
import { mapRemnantRow } from "@/lib/remnants";
import { mapAuditRow } from "@/lib/storage";
import {
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import type { CarpetAudit, Remnant } from "@/lib/types";

const REMNANT_COLUMNS =
  "id, store_number, sku, carpet_name, category, tag_number, width_ft, length_ft, square_feet, square_yards, location, notes, status, reserved_for, logged_by, estimated_value, markdown_percent, markdown_price, markdown_notes, markdown_by, markdown_at, created_at, updated_at";

const AUDIT_COLUMNS =
  "id, store_number, sku, carpet_name, category, sub_category, sims_location, location_type, measurement_inches, measurement_fraction, rounds, calculated_clf, box_count, calculated_sqft, system_clf, variance_clf, audited_by, created_at";

/**
 * POST /api/flooring/ai-insights
 * Compact-then-narrate remnant aging + CLF variance. Store Ops JWT required.
 * Fetches remnants/audits server-side — does not accept client table dumps.
 */
export async function POST(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      allow_local_fallback?: boolean;
    };

    const store = actor.storeNumber;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [{ data: remnantRows, error: remnantError }, { data: auditRows, error: auditError }] =
      await Promise.all([
        supabase
          .from("carpet_remnants")
          .select(REMNANT_COLUMNS)
          .eq("store_number", store)
          .neq("status", "sold")
          .order("created_at", { ascending: false })
          .limit(80),
        supabase
          .from("carpet_audits")
          .select(AUDIT_COLUMNS)
          .eq("store_number", store)
          .gte("created_at", startOfDay.toISOString())
          .order("created_at", { ascending: false })
          .limit(80),
      ]);

    if (remnantError) throw new Error(remnantError.message);
    if (auditError) throw new Error(auditError.message);

    const remnants: Remnant[] = (remnantRows ?? []).map((row) =>
      mapRemnantRow(row as Record<string, unknown>)
    );
    let audits: CarpetAudit[] = (auditRows ?? []).map((row) =>
      mapAuditRow(row as Record<string, unknown>)
    );

    if (audits.length === 0) {
      const { data: recent, error: recentError } = await supabase
        .from("carpet_audits")
        .select(AUDIT_COLUMNS)
        .eq("store_number", store)
        .order("created_at", { ascending: false })
        .limit(40);
      if (recentError) throw new Error(recentError.message);
      audits = (recent ?? []).map((row) =>
        mapAuditRow(row as Record<string, unknown>)
      );
    }

    if (audits.length === 0 && remnants.length === 0) {
      return NextResponse.json(
        {
          error:
            "No remnant inventory or cycle audits found for this store",
        },
        { status: 400 }
      );
    }

    const local = buildLocalFlooringInsights(remnants, audits);

    if (!isGeminiConfigured()) {
      if (body.allow_local_fallback === false) {
        return NextResponse.json(
          {
            error:
              "GEMINI_API_KEY is not configured — set it in .env.local for Flooring AI insights",
          },
          { status: 503 }
        );
      }
      return NextResponse.json({
        ...local,
        source: "local" as const,
      });
    }

    const packet = compactFlooringInsightsForPrompt(local);
    const parsed = await callGeminiFlashJson<unknown>(
      buildFlooringInsightsPrompt({
        packet,
        storeNumber: store,
      }),
      {
        maxOutputTokens: GEMINI_TOKEN_BUDGET.insights,
        responseSchema: FLOORING_INSIGHTS_RESPONSE_SCHEMA,
        prefer: "object",
      }
    );
    const insights: FlooringAiInsights = mergeNarratedFlooringInsights(
      local,
      parsed,
      remnants
    );

    return NextResponse.json({
      ...insights,
      source: "gemini" as const,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[flooring/ai-insights]", err);
    return NextResponse.json(
      {
        error: readableError(
          err,
          "Flooring AI insights failed — check Gemini configuration and payload"
        ),
      },
      { status: 400 }
    );
  }
}
