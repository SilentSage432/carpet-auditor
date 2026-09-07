import { NextResponse } from "next/server";
import {
  mapApplianceCatalogRow,
  normalizeApplianceIdentifier,
} from "@/lib/appliance-catalog";
import { actorBoundStoreNumber } from "@/lib/store-ops/appliance-store-scope";
import {
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * POST /api/appliances/catalog/identifiers
 * Teach a scannable identifier onto an existing canonical item (APP-CAT-001A).
 * Does not rewrite catalog metadata or legacy upc. Does not rewrite scans.
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

    const body = (await request.json()) as Record<string, unknown>;
    const store = actorBoundStoreNumber(
      actor,
      body.store_number != null ? String(body.store_number) : null
    );
    const item_number = String(body.item_number ?? "").trim();
    const identifier = normalizeApplianceIdentifier(body.identifier);

    if (!item_number) {
      return NextResponse.json(
        { error: "item_number is required" },
        { status: 400 }
      );
    }
    if (!identifier) {
      return NextResponse.json(
        { error: "identifier is required" },
        { status: 400 }
      );
    }

    const { data: catalogRow, error: catalogError } = await supabase
      .from("appliance_catalog")
      .select("*")
      .eq("store_number", store)
      .eq("item_number", item_number)
      .maybeSingle();

    if (catalogError) {
      return NextResponse.json({ error: catalogError.message }, { status: 500 });
    }
    if (!catalogRow) {
      return NextResponse.json(
        { error: `Item ${item_number} not found in catalog` },
        { status: 404 }
      );
    }

    // Conflict: identifier owned by another item (alias table or legacy upc).
    const { data: idRows, error: idError } = await supabase
      .from("appliance_catalog_identifiers")
      .select("*")
      .eq("store_number", store)
      .eq("identifier", identifier);
    if (idError) {
      return NextResponse.json({ error: idError.message }, { status: 500 });
    }
    const idConflict = (idRows ?? []).find(
      (row) => String((row as { item_number?: string }).item_number ?? "").trim() !== item_number
    );
    if (idConflict) {
      const ownerItem = String(
        (idConflict as { item_number?: string }).item_number ?? "?"
      ).trim();
      const { data: conflictCatalog } = await supabase
        .from("appliance_catalog")
        .select("*")
        .eq("store_number", store)
        .eq("item_number", ownerItem)
        .maybeSingle();
      return NextResponse.json(
        {
          error: `Identifier ${identifier} is already linked to Item ${ownerItem}. Clear or change that link first.`,
          conflict: conflictCatalog ?? idConflict,
        },
        { status: 409 }
      );
    }

    const { data: upcOwners, error: upcError } = await supabase
      .from("appliance_catalog")
      .select("*")
      .eq("store_number", store)
      .eq("upc", identifier);
    if (upcError) {
      return NextResponse.json({ error: upcError.message }, { status: 500 });
    }
    const upcConflict = (upcOwners ?? []).find(
      (row) => String((row as { item_number?: string }).item_number ?? "").trim() !== item_number
    );
    if (upcConflict) {
      return NextResponse.json(
        {
          error: `Identifier ${identifier} is already linked to Item ${String(
            (upcConflict as { item_number?: string }).item_number ?? "?"
          ).trim()}. Clear or change that link first.`,
          conflict: upcConflict,
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const payload = {
      id: body.id ? String(body.id) : undefined,
      store_number: store,
      item_number,
      identifier,
      updated_at: now,
      created_at: now,
    };

    // Insert only — never upsert item_number onto an existing identifier (no silent steal).
    const { data, error } = await supabase
      .from("appliance_catalog_identifiers")
      .insert(payload)
      .select("*")
      .maybeSingle();

    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        const { data: existing } = await supabase
          .from("appliance_catalog_identifiers")
          .select("*")
          .eq("store_number", store)
          .eq("identifier", identifier)
          .maybeSingle();
        const owner = String(
          (existing as { item_number?: string } | null)?.item_number ?? ""
        ).trim();
        if (owner === item_number) {
          return NextResponse.json({
            identifier: existing,
            item: mapApplianceCatalogRow(catalogRow as Record<string, unknown>),
          });
        }
        return NextResponse.json(
          {
            error: `Identifier ${identifier} is already linked to Item ${owner || "?"}. Clear or change that link first.`,
            conflict: existing,
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      identifier: data,
      item: mapApplianceCatalogRow(catalogRow as Record<string, unknown>),
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
