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
import { normalizeApplianceCategory } from "@/lib/types";

/**
 * POST /api/appliances/catalog/ensure — APP-CAT-001A-FIX-001A
 *
 * Ensure ONE canonical parent catalog item exists for the actor-bound store before
 * an identifier alias is written against it.
 *
 * `appliance_catalog_identifiers_item_fkey` requires the parent
 * `(store_number, item_number)` to exist in `appliance_catalog`. A device catalog can
 * legitimately hold an item that was never persisted for the actor's current store,
 * so Link Existing must guarantee the parent before teaching the alias.
 *
 * This is NOT bulk promotion. Exactly one explicitly chosen canonical item is
 * ensured, never a device catalog sync (APP-CAT-001B remains deferred).
 *
 * Idempotent and non-destructive: an existing parent is returned untouched — its
 * server metadata is never rewritten with device values.
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

    if (!item_number) {
      return NextResponse.json(
        { error: "item_number is required" },
        { status: 400 }
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from("appliance_catalog")
      .select("*")
      .eq("store_number", store)
      .eq("item_number", item_number)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { error: existingError.message },
        { status: 500 }
      );
    }

    // Parent already present — return it untouched. No write, no metadata rewrite.
    if (existing) {
      return NextResponse.json({
        created: false,
        item: mapApplianceCatalogRow(existing as Record<string, unknown>),
      });
    }

    const upcRaw = body.upc;
    const upc =
      upcRaw == null || upcRaw === ""
        ? null
        : normalizeApplianceIdentifier(upcRaw) || null;

    // Never steal a legacy upc that another canonical item already owns.
    if (upc) {
      const { data: idRows, error: idError } = await supabase
        .from("appliance_catalog_identifiers")
        .select("*")
        .eq("store_number", store)
        .eq("identifier", upc);
      if (idError) {
        return NextResponse.json({ error: idError.message }, { status: 500 });
      }
      const idOwner = (idRows ?? []).find(
        (row) =>
          String((row as { item_number?: string }).item_number ?? "").trim() !==
          item_number
      );

      const { data: upcRows, error: upcError } = await supabase
        .from("appliance_catalog")
        .select("*")
        .eq("store_number", store)
        .eq("upc", upc);
      if (upcError) {
        return NextResponse.json({ error: upcError.message }, { status: 500 });
      }
      const upcOwner = (upcRows ?? []).find(
        (row) =>
          String((row as { item_number?: string }).item_number ?? "").trim() !==
          item_number
      );

      const conflict = idOwner ?? upcOwner;
      if (conflict) {
        const owner = String(
          (conflict as { item_number?: string }).item_number ?? "?"
        ).trim();
        return NextResponse.json(
          {
            error: `UPC ${upc} is already linked to Item ${owner}. Clear or change that mapping first.`,
            conflict: upcOwner ?? conflict,
          },
          { status: 409 }
        );
      }
    }

    const now = new Date().toISOString();
    // Only metadata the device actually knows — nothing is manufactured.
    // sub_category may be empty; appliance_catalog defaults it to ''.
    const payload = {
      id: body.id ? String(body.id) : undefined,
      store_number: store,
      item_number,
      upc,
      description: String(body.description ?? "").trim(),
      category: normalizeApplianceCategory(body.category),
      sub_category: String(body.sub_category ?? "").trim(),
      created_at: now,
      updated_at: now,
    };

    // Insert only — a concurrent creator must win rather than be overwritten.
    const { data, error } = await supabase
      .from("appliance_catalog")
      .insert(payload)
      .select("*")
      .maybeSingle();

    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        const { data: raced } = await supabase
          .from("appliance_catalog")
          .select("*")
          .eq("store_number", store)
          .eq("item_number", item_number)
          .maybeSingle();
        if (raced) {
          return NextResponse.json({
            created: false,
            item: mapApplianceCatalogRow(raced as Record<string, unknown>),
          });
        }
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      created: true,
      item: mapApplianceCatalogRow(
        (data ?? payload) as Record<string, unknown>
      ),
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
