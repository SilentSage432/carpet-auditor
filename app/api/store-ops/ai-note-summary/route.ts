import { NextResponse } from "next/server";
import {
  callGeminiFlash,
  isGeminiConfigured,
  parseGeminiJson,
} from "@/lib/ai/gemini";
import {
  buildLocalNoteSummary,
  buildNoteSummaryPrompt,
  normalizeNoteSummaryResult,
  resolveImageMimeType,
  type NoteSummaryResult,
} from "@/lib/store-ops/ai-note-summary";
import {
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";

/**
 * POST /api/store-ops/ai-note-summary
 * Gemini Flash multimodal manager note (+ optional S Pen PNG) → summary + action items.
 */
export async function POST(request: Request) {
  try {
    requireStoreOpsActor(await resolveStoreOpsActor(request));

    const body = (await request.json()) as {
      title?: string;
      content?: string;
      canvas_data_url?: string;
      department_code?: string;
      aisle?: string;
      bay?: number | string;
      allow_local_fallback?: boolean;
    };

    const title = String(body.title ?? "").trim();
    const content = String(body.content ?? "").trim();
    const canvas = String(body.canvas_data_url ?? "").trim();

    if (!title && !content && !canvas) {
      return NextResponse.json(
        { error: "title, content, or canvas_data_url is required" },
        { status: 400 }
      );
    }

    if (canvas.length > 8_000_000) {
      return NextResponse.json(
        { error: "Canvas image too large — clear strokes and redraw a smaller annotation" },
        { status: 413 }
      );
    }

    const bayRaw = body.bay;
    const bayNum =
      bayRaw === undefined || bayRaw === null || bayRaw === ""
        ? undefined
        : Number(bayRaw);

    const input = {
      title,
      content,
      canvas_data_url: canvas || undefined,
      department_code: String(body.department_code ?? "").trim() || undefined,
      aisle: String(body.aisle ?? "").trim() || undefined,
      bay: Number.isFinite(bayNum as number) ? Number(bayNum) : undefined,
    };

    if (!isGeminiConfigured()) {
      if (body.allow_local_fallback === false) {
        return NextResponse.json(
          {
            error:
              "GEMINI_API_KEY is not configured — set it in .env.local for Manager Note synthesis",
          },
          { status: 503 }
        );
      }
      const local = buildLocalNoteSummary(input);
      return NextResponse.json({
        ...local,
        source: "local" as const,
      });
    }

    const prompt = buildNoteSummaryPrompt(input);
    const rawText = await callGeminiFlash(
      prompt,
      canvas
        ? {
            mimeType: resolveImageMimeType(canvas),
            data: canvas,
          }
        : undefined
    );
    const parsed = parseGeminiJson<unknown>(rawText, "object");
    const result: NoteSummaryResult = normalizeNoteSummaryResult(parsed);

    return NextResponse.json({
      ...result,
      source: "gemini" as const,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[store-ops/ai-note-summary]", err);
    return NextResponse.json(
      {
        error: readableError(
          err,
          "Manager note synthesis failed — check Gemini configuration and note payload"
        ),
      },
      { status: 400 }
    );
  }
}
