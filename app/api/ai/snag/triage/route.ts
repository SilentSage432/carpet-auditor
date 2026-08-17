import { NextResponse } from "next/server";
import {
  callGeminiFlashJson,
  GEMINI_TOKEN_BUDGET,
  isGeminiConfigured,
} from "@/lib/ai/gemini";
import {
  buildLocalSnagTriage,
  buildSnagTriagePrompt,
  capSnagTriageText,
  normalizeSnagTriageResult,
  SNAG_TRIAGE_RESPONSE_SCHEMA,
  type SnagTriageInput,
} from "@/lib/store-ops/ai-snag-triage";
import {
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";
import { resolveDepartmentIdByCode } from "@/lib/store-ops/rotations";
import { dispatchSnagTriage } from "@/lib/store-ops/snag-dispatch";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { isoWeekLabel } from "@/lib/store-ops/week";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * POST /api/ai/snag/triage
 * Body: { text, department_code?, location_tag?, store_number?, dispatch?, rotation_id?, location_id?, assigned_week? }
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

    const body = (await request.json()) as {
      text?: string;
      department_code?: string;
      location_tag?: string;
      store_number?: string;
      dispatch?: boolean;
      allow_local_fallback?: boolean;
      rotation_id?: string;
      location_id?: string;
      assigned_week?: string;
    };

    const text = capSnagTriageText(String(body.text ?? ""));
    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const store = await resolveStoreByNumber(
      supabase,
      String(body.store_number ?? actor.storeNumber)
    );

    const departmentCode =
      String(body.department_code ?? actor.departmentCode ?? "flooring").trim() ||
      "flooring";

    const payload: SnagTriageInput = {
      text,
      department_code: departmentCode,
      location_tag: String(body.location_tag ?? "").trim() || undefined,
    };

    let triage;
    let source: "gemini" | "local" = "local";

    if (!isGeminiConfigured()) {
      if (body.allow_local_fallback === false) {
        return NextResponse.json(
          {
            error:
              "GEMINI_API_KEY is not configured — set it in .env.local for Snag Triage",
          },
          { status: 503 }
        );
      }
      triage = buildLocalSnagTriage(payload);
    } else {
      const parsed = await callGeminiFlashJson<unknown>(
        buildSnagTriagePrompt(payload),
        {
          maxOutputTokens: GEMINI_TOKEN_BUDGET.copilot,
          responseSchema: SNAG_TRIAGE_RESPONSE_SCHEMA,
          prefer: "object",
        }
      );
      triage = normalizeSnagTriageResult(parsed, payload);
      source = "gemini";
    }

    let dispatchResult = null;
    if (body.dispatch === true) {
      const departmentId =
        (await resolveDepartmentIdByCode(
          supabase,
          departmentCode,
          store.id
        )) ?? "";
      if (!departmentId) {
        return NextResponse.json(
          { error: "Department not found for dispatch" },
          { status: 404 }
        );
      }
      dispatchResult = await dispatchSnagTriage(supabase, {
        storeNumber: store.store_number,
        departmentId,
        departmentCode,
        assignedWeek: body.assigned_week?.trim() || isoWeekLabel(),
        rotationId: body.rotation_id?.trim() || null,
        locationId: body.location_id?.trim() || null,
        reportedBy: actor.specialistId,
        triage,
      });
    }

    return NextResponse.json({
      ok: true,
      ...triage,
      source,
      dispatch: dispatchResult,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[ai/snag/triage]", err);
    return NextResponse.json(
      {
        error: readableError(err, "Snag triage failed"),
      },
      { status: 400 }
    );
  }
}
