import { NextResponse } from "next/server";
import {
  callGeminiFlash,
  isGeminiConfigured,
  parseGeminiJson,
} from "@/lib/ai/gemini";
import {
  buildApplianceAnomalyPrompt,
  buildLocalApplianceAnomalies,
  normalizeApplianceAnomalies,
  type ApplianceAnomalyResult,
} from "@/lib/appliances/ai-anomaly";
import { readableError } from "@/lib/store-ops/errors";
import type { ApplianceCatalogItem, ApplianceScan } from "@/lib/types";

/**
 * POST /api/appliances/ai-anomaly
 * Gemini (or local heuristics) anomaly detection over recent appliance scans.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      scans?: ApplianceScan[];
      catalog?: ApplianceCatalogItem[];
      store_number?: string;
      allow_local_fallback?: boolean;
    };

    const scans = Array.isArray(body.scans) ? body.scans : [];
    const catalog = Array.isArray(body.catalog) ? body.catalog : [];
    const storeNumber = String(body.store_number ?? "").trim();

    if (scans.length === 0 && catalog.length === 0) {
      return NextResponse.json(
        {
          error:
            "Provide recent appliance_scans and/or appliance_catalog entries",
        },
        { status: 400 }
      );
    }

    if (!isGeminiConfigured()) {
      if (body.allow_local_fallback === false) {
        return NextResponse.json(
          {
            error:
              "GEMINI_API_KEY is not configured — set it in .env.local for Appliance Anomaly Detection",
          },
          { status: 503 }
        );
      }
      const local = buildLocalApplianceAnomalies(scans, catalog);
      return NextResponse.json({
        ...local,
        source: "local" as const,
      });
    }

    const prompt = buildApplianceAnomalyPrompt({
      scans,
      catalog,
      storeNumber: storeNumber || undefined,
    });
    const rawText = await callGeminiFlash(prompt);
    const parsed = parseGeminiJson<unknown>(rawText, "object");
    const result: ApplianceAnomalyResult = normalizeApplianceAnomalies(parsed);

    return NextResponse.json({
      ...result,
      source: "gemini" as const,
    });
  } catch (err) {
    console.error("[appliances/ai-anomaly]", err);
    return NextResponse.json(
      {
        error: readableError(
          err,
          "Appliance anomaly detection failed — check Gemini configuration and payload"
        ),
      },
      { status: 400 }
    );
  }
}
