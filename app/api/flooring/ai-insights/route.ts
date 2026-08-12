import { NextResponse } from "next/server";
import {
  callGeminiFlash,
  isGeminiConfigured,
  parseGeminiJson,
} from "@/lib/ai/gemini";
import {
  buildFlooringInsightsPrompt,
  buildLocalFlooringInsights,
  normalizeFlooringInsights,
  type FlooringAiInsights,
} from "@/lib/flooring/ai-insights";
import { readableError } from "@/lib/store-ops/errors";
import type { CarpetAudit, Remnant } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      audits?: CarpetAudit[];
      remnants?: Remnant[];
      store_number?: string;
      allow_local_fallback?: boolean;
    };

    const audits = Array.isArray(body.audits) ? body.audits : [];
    const remnants = Array.isArray(body.remnants) ? body.remnants : [];
    const storeNumber = String(body.store_number ?? "").trim();

    if (audits.length === 0 && remnants.length === 0) {
      return NextResponse.json(
        {
          error:
            "Provide cycle audit variance data and/or remnant inventory records",
        },
        { status: 400 }
      );
    }

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
      const local = buildLocalFlooringInsights(remnants, audits);
      return NextResponse.json({
        ...local,
        source: "local" as const,
      });
    }

    const prompt = buildFlooringInsightsPrompt({
      audits,
      remnants,
      storeNumber: storeNumber || undefined,
    });

    const rawText = await callGeminiFlash(prompt);
    const parsed = parseGeminiJson<unknown>(rawText, "object");
    const insights: FlooringAiInsights = normalizeFlooringInsights(
      parsed,
      remnants
    );

    return NextResponse.json({
      ...insights,
      source: "gemini" as const,
    });
  } catch (err) {
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
