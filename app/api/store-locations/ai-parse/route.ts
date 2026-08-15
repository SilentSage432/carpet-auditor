import { NextResponse } from "next/server";
import {
  callGeminiFlashJson,
  GEMINI_TOKEN_BUDGET,
  isGeminiConfigured,
} from "@/lib/ai/gemini";
import {
  AI_PARSE_MAX_CHARS,
  AI_PARSE_RESPONSE_SCHEMA,
  buildAiLocationParsePrompt,
  normalizeAiParsePayload,
  type AiParseResult,
} from "@/lib/store-ops/ai-parse";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";

export async function POST(request: Request) {
  try {
    requireSuperAdmin(await resolveStoreOpsActor(request));

    if (!isGeminiConfigured()) {
      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY is not configured — set it in .env.local to use AI Pre-Flight",
        },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      text?: string;
      known_department_codes?: string[];
      default_department_code?: string;
    };

    const text = String(body.text ?? "").trim();
    if (!text) {
      return NextResponse.json(
        { error: "text is required (raw notes, CSV, or aisle/bay list)" },
        { status: 400 }
      );
    }
    const capped = text.slice(0, AI_PARSE_MAX_CHARS);

    const knownDepartmentCodes = Array.isArray(body.known_department_codes)
      ? body.known_department_codes.map((c) => String(c).trim()).filter(Boolean)
      : [];
    const defaultDepartmentCode = String(
      body.default_department_code ?? ""
    ).trim();

    const prompt = buildAiLocationParsePrompt({
      text: capped,
      knownDepartmentCodes,
      defaultDepartmentCode: defaultDepartmentCode || undefined,
    });

    const parsed = await callGeminiFlashJson<unknown>(prompt, {
      maxOutputTokens: GEMINI_TOKEN_BUDGET.parse,
      responseSchema: AI_PARSE_RESPONSE_SCHEMA,
      prefer: "object",
    });
    const result: AiParseResult = normalizeAiParsePayload(parsed, {
      knownDepartmentCodes,
      defaultDepartmentCode: defaultDepartmentCode || undefined,
    });

    if (result.locations.length === 0) {
      return NextResponse.json(
        {
          error:
            "AI could not extract any valid locations — check aisle codes and bay ranges",
          corrections_made: result.corrections_made,
          locations: [],
        },
        { status: 422 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[store-locations/ai-parse]", err);
    return NextResponse.json(
      {
        error: readableError(
          err,
          "AI Pre-Flight parse failed — check Gemini configuration and input text"
        ),
      },
      { status: 400 }
    );
  }
}
