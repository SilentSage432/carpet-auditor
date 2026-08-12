import { NextResponse } from "next/server";
import {
  callGeminiFlash,
  isGeminiConfigured,
  parseGeminiJson,
} from "@/lib/ai/gemini";
import {
  buildBayScanPrompt,
  buildLocalBayScanResult,
  normalizeBayScanResult,
  resolveImageMimeType,
  type BayScanResult,
} from "@/lib/store-ops/ai-bay-scan";
import {
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import { readableError } from "@/lib/store-ops/errors";

/**
 * POST /api/store-ops/ai-bay-scan
 * Gemini Flash multimodal bay photo → inventory/safety compliance JSON.
 */
export async function POST(request: Request) {
  try {
    requireStoreOpsActor(await resolveStoreOpsActor(request));

    const body = (await request.json()) as {
      image?: string;
      mime_type?: string;
      aisle?: string;
      bay?: number | string;
      department_code?: string;
      allow_local_fallback?: boolean;
    };

    const image = String(body.image ?? "").trim();
    if (!image) {
      return NextResponse.json(
        { error: "image is required (base64 or data-URL)" },
        { status: 400 }
      );
    }

    // Guard extreme payloads (roughly > ~6MB base64)
    if (image.length > 8_000_000) {
      return NextResponse.json(
        { error: "Image too large — capture a smaller bay photo and retry" },
        { status: 413 }
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
      department_code: String(body.department_code ?? "").trim() || undefined,
    };

    if (!isGeminiConfigured()) {
      if (body.allow_local_fallback === false) {
        return NextResponse.json(
          {
            error:
              "GEMINI_API_KEY is not configured — set it in .env.local for Visual Bay Scan",
          },
          { status: 503 }
        );
      }
      const local = buildLocalBayScanResult(meta);
      return NextResponse.json({
        ...local,
        source: "local" as const,
      });
    }

    const mimeType = resolveImageMimeType(image, body.mime_type);
    const prompt = buildBayScanPrompt(meta);
    const rawText = await callGeminiFlash(prompt, {
      mimeType,
      data: image,
    });
    const parsed = parseGeminiJson<unknown>(rawText, "object");
    const result: BayScanResult = normalizeBayScanResult(parsed);

    return NextResponse.json({
      ...result,
      source: "gemini" as const,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[store-ops/ai-bay-scan]", err);
    return NextResponse.json(
      {
        error: readableError(
          err,
          "Visual bay scan failed — check Gemini configuration and image payload"
        ),
      },
      { status: 400 }
    );
  }
}
