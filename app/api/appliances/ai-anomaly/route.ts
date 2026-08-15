import { NextResponse } from "next/server";
import {
  callGeminiFlashJson,
  GEMINI_TOKEN_BUDGET,
  isGeminiConfigured,
} from "@/lib/ai/gemini";
import { mapApplianceCatalogRow } from "@/lib/appliance-catalog";
import { mapApplianceScanRow } from "@/lib/appliance-scans";
import {
  APPLIANCE_ANOMALY_RESPONSE_SCHEMA,
  buildApplianceAnomalyPrompt,
  buildLocalApplianceAnomalies,
  compactApplianceAnomaliesForPrompt,
  mergeNarratedApplianceAnomalies,
  type ApplianceAnomalyResult,
} from "@/lib/appliances/ai-anomaly";
import {
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import type { ApplianceCatalogItem, ApplianceScan } from "@/lib/types";

const SCAN_COLUMNS =
  "id, store_number, item_number, serial_number, location, category, sub_category, scanned_by, scanned_at";
const CATALOG_COLUMNS =
  "id, store_number, item_number, upc, description, category, sub_category, created_at, updated_at";

/**
 * POST /api/appliances/ai-anomaly
 * Compact-then-narrate appliance scan anomalies. Store Ops JWT required.
 * Fetches scans/catalog server-side — does not accept client table dumps.
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

    const [{ data: scanRows, error: scanError }, { data: catalogRows, error: catalogError }] =
      await Promise.all([
        supabase
          .from("appliance_scans")
          .select(SCAN_COLUMNS)
          .eq("store_number", store)
          .order("scanned_at", { ascending: false })
          .limit(120),
        supabase
          .from("appliance_catalog")
          .select(CATALOG_COLUMNS)
          .eq("store_number", store)
          .order("item_number")
          .limit(120),
      ]);

    if (scanError) throw new Error(scanError.message);
    if (catalogError) throw new Error(catalogError.message);

    const scans: ApplianceScan[] = (scanRows ?? []).map((row) =>
      mapApplianceScanRow(row as Record<string, unknown>)
    );
    const catalog: ApplianceCatalogItem[] = (catalogRows ?? []).map((row) =>
      mapApplianceCatalogRow(row as Record<string, unknown>)
    );

    if (scans.length === 0 && catalog.length === 0) {
      return NextResponse.json(
        {
          error:
            "No appliance scans or catalog entries found for this store",
        },
        { status: 400 }
      );
    }

    const local = buildLocalApplianceAnomalies(scans, catalog);

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
      return NextResponse.json({
        ...local,
        source: "local" as const,
      });
    }

    const packet = compactApplianceAnomaliesForPrompt(local, {
      scan_count: scans.length,
      catalog_count: catalog.length,
    });
    const parsed = await callGeminiFlashJson<unknown>(
      buildApplianceAnomalyPrompt({
        packet,
        storeNumber: store,
      }),
      {
        maxOutputTokens: GEMINI_TOKEN_BUDGET.insights,
        responseSchema: APPLIANCE_ANOMALY_RESPONSE_SCHEMA,
        prefer: "object",
      }
    );
    const result: ApplianceAnomalyResult = mergeNarratedApplianceAnomalies(
      local,
      parsed
    );

    return NextResponse.json({
      ...result,
      source: "gemini" as const,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
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
