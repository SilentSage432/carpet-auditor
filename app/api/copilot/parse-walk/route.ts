import { NextResponse } from "next/server";
import {
  callGeminiFlashJson,
  GEMINI_TOKEN_BUDGET,
  isGeminiConfigured,
} from "@/lib/ai/gemini";
import {
  buildLocalWalkParse,
  buildWalkParsePrompt,
  capWalkParseContent,
  normalizeWalkParseResult,
  WALK_PARSE_RESPONSE_SCHEMA,
  type WalkParseInput,
  type WalkParseResult,
} from "@/lib/store-ops/ai-walk-parse";
import {
  resolveStoreOpsActor,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";

/**
 * POST /api/copilot/parse-walk
 * Supervisor / Super Admin — Gemini floor-walk transcript → structured tasks.
 * Canonical owner: `lib/store-ops/ai-walk-parse.ts` (not note extract).
 */
export async function POST(request: Request) {
  try {
    requireSupervisorOrAdmin(await resolveStoreOpsActor(request));

    const body = (await request.json()) as {
      transcript?: string;
      department_code?: string;
      roster_names?: string[];
      allow_local_fallback?: boolean;
    };

    const transcript = capWalkParseContent(String(body.transcript ?? ""));
    if (!transcript) {
      return NextResponse.json(
        { error: "transcript is required" },
        { status: 400 }
      );
    }

    const roster_names = Array.isArray(body.roster_names)
      ? body.roster_names.map((n) => String(n).trim()).filter(Boolean)
      : [];
    const payload: WalkParseInput = {
      transcript,
      department_code: String(body.department_code ?? "").trim() || undefined,
      roster_names,
    };

    if (!isGeminiConfigured()) {
      if (body.allow_local_fallback === false) {
        return NextResponse.json(
          {
            error:
              "GEMINI_API_KEY is not configured — set it in .env.local for Floor Walk Copilot",
          },
          { status: 503 }
        );
      }
      const local: WalkParseResult = {
        tasks: buildLocalWalkParse(payload),
        source: "local",
      };
      return NextResponse.json(local);
    }

    const raw = await callGeminiFlashJson<unknown>(
      buildWalkParsePrompt(payload),
      {
        maxOutputTokens: GEMINI_TOKEN_BUDGET.copilot,
        responseSchema: WALK_PARSE_RESPONSE_SCHEMA,
        prefer: "object",
      }
    );

    const result: WalkParseResult = {
      tasks: normalizeWalkParseResult(raw, payload),
      source: "gemini",
    };
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[copilot/parse-walk]", err);
    return NextResponse.json(
      {
        error: readableError(
          err,
          "Gemini Copilot could not structure the floor walk"
        ),
      },
      { status: 400 }
    );
  }
}
