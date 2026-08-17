import { NextResponse } from "next/server";
import {
  callGeminiFlashJson,
  GEMINI_TOKEN_BUDGET,
  isGeminiConfigured,
} from "@/lib/ai/gemini";
import type { BayAuditVerdictResult } from "@/lib/ai/contracts/bay-audit";
import {
  BAY_AUDIT_RESPONSE_SCHEMA,
  buildBayAuditPrompt,
  buildLocalBayAuditVerdict,
  formatBayNumber,
  normalizeBayAuditVerdict,
} from "@/lib/store-ops/ai-bay-audit";
import { insertBayAuditLog } from "@/lib/store-ops/bay-audit-logs";
import {
  resolveImageMimeType,
} from "@/lib/store-ops/ai-bay-scan";
import {
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * POST /api/ai/bay-audit/validate
 * Multimodal bay audit → rubric verdict + bay_audit_logs persistence.
 */
export async function POST(request: Request) {
  const started = Date.now();
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
      image?: string;
      mime_type?: string;
      aisle?: string;
      bay?: number | string;
      department_id?: string;
      department_code?: string;
      rotation_id?: string;
      bay_number?: string;
      image_url?: string;
      allow_local_fallback?: boolean;
    };

    const image = String(body.image ?? "").trim();
    if (!image) {
      return NextResponse.json(
        { error: "image is required (base64 or data-URL)" },
        { status: 400 }
      );
    }
    if (image.length > 1_500_000) {
      return NextResponse.json(
        { error: "Image too large — capture a smaller bay photo and retry" },
        { status: 413 }
      );
    }

    const departmentId = String(body.department_id ?? "").trim();
    if (!departmentId) {
      return NextResponse.json(
        { error: "department_id is required" },
        { status: 400 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);

    const { data: dept, error: deptError } = await supabase
      .from("departments")
      .select("id, code, store_id")
      .eq("id", departmentId)
      .eq("store_id", store.id)
      .maybeSingle();
    if (deptError) {
      return NextResponse.json({ error: deptError.message }, { status: 500 });
    }
    if (!dept) {
      return NextResponse.json(
        { error: "Department not found for this store" },
        { status: 404 }
      );
    }

    const bayRaw = body.bay;
    const bayNum =
      bayRaw === undefined || bayRaw === null || bayRaw === ""
        ? undefined
        : Number(bayRaw);
    const meta = {
      aisle: String(body.aisle ?? "").trim() || undefined,
      bay: Number.isFinite(bayNum as number) ? Number(bayNum) : undefined,
      department_code:
        String(body.department_code ?? dept.code ?? "").trim() || undefined,
    };

    let audit: BayAuditVerdictResult;
    let source: "gemini" | "local" = "local";

    if (!isGeminiConfigured()) {
      if (body.allow_local_fallback === false) {
        return NextResponse.json(
          {
            error:
              "GEMINI_API_KEY is not configured — set it in .env.local for Bay Audit",
          },
          { status: 503 }
        );
      }
      audit = buildLocalBayAuditVerdict(meta);
    } else {
      const mimeType = resolveImageMimeType(image, body.mime_type);
      const parsed = await callGeminiFlashJson<unknown>(
        buildBayAuditPrompt(meta),
        {
          inlineImageData: { mimeType, data: image },
          prefer: "object",
          maxOutputTokens: GEMINI_TOKEN_BUDGET.bayScan,
          responseSchema: BAY_AUDIT_RESPONSE_SCHEMA,
        }
      );
      audit = normalizeBayAuditVerdict(parsed);
      source = "gemini";
    }

    const latency_ms = Date.now() - started;
    const bay_number =
      String(body.bay_number ?? "").trim() || formatBayNumber(meta);

    const log = await insertBayAuditLog(supabase, {
      store_number: store.store_number,
      department_id: departmentId,
      bay_number,
      rotation_id: body.rotation_id?.trim() || null,
      actor_id: actor.specialistId || null,
      verdict: audit.verdict,
      rubric: audit.rubric,
      detected_issues: audit.detected_issues,
      carton_estimate: audit.carton_count_estimate,
      image_url: body.image_url?.trim() || null,
      source,
      latency_ms,
    });

    return NextResponse.json({
      ok: true,
      ...audit,
      audit_log_id: log.id,
      source,
      latency_ms,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[ai/bay-audit/validate]", err);
    return NextResponse.json(
      {
        error: readableError(err, "Bay audit validation failed"),
      },
      { status: 400 }
    );
  }
}
