import { NextResponse } from "next/server";
import {
  callGeminiFlashJson,
  GEMINI_TOKEN_BUDGET,
  isGeminiConfigured,
} from "@/lib/ai/gemini";
import {
  buildLocalTaxonomy,
  buildTaxonomyPrompt,
  composeTaxonomyWithDefaults,
  normalizeAiTaxonomy,
  TAXONOMY_RESPONSE_SCHEMA,
  type AiTaxonomyResult,
} from "@/lib/catalog/ai-taxonomy";
import { normalizeTaxonomyCode } from "@/lib/catalog/taxonomies";
import {
  resolveStoreOpsActor,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";

/**
 * POST /api/catalog/ai-taxonomy
 * Gemini (or registry defaults) department catalog taxonomy for folder browse.
 * Supervisor or Super Admin JWT required.
 */
export async function POST(request: Request) {
  try {
    requireSupervisorOrAdmin(await resolveStoreOpsActor(request));

    const body = (await request.json()) as {
      department_code?: string;
      department_name?: string;
      allow_local_fallback?: boolean;
    };

    const department_code = String(body.department_code ?? "").trim();
    const department_name = String(body.department_name ?? "").trim();

    if (!department_code) {
      return NextResponse.json(
        { error: "department_code is required" },
        { status: 400 }
      );
    }

    const code = normalizeTaxonomyCode(department_code) || department_code;
    const name = department_name || code;

    if (!isGeminiConfigured()) {
      if (body.allow_local_fallback === false) {
        return NextResponse.json(
          {
            error:
              "GEMINI_API_KEY is not configured — set it in .env.local for AI Taxonomy Generator",
          },
          { status: 503 }
        );
      }
      const local = buildLocalTaxonomy(code, name);
      const result: AiTaxonomyResult = { ...local, source: "local" };
      return NextResponse.json(result);
    }

    const parsed = await callGeminiFlashJson<unknown>(
      buildTaxonomyPrompt({
        department_code: code,
        department_name: name,
      }),
      {
        maxOutputTokens: GEMINI_TOKEN_BUDGET.taxonomy,
        responseSchema: TAXONOMY_RESPONSE_SCHEMA,
        prefer: "object",
      }
    );
    const normalized = normalizeAiTaxonomy(parsed, code, name);
    const composed = composeTaxonomyWithDefaults(normalized, code, name);

    const result: AiTaxonomyResult = {
      ...composed,
      source: "gemini",
    };
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[catalog/ai-taxonomy]", err);
    return NextResponse.json(
      {
        error: readableError(
          err,
          "AI taxonomy generation failed — check Gemini configuration and payload"
        ),
      },
      { status: 400 }
    );
  }
}
