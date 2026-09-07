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
import {
  isValidApplianceSubCategory,
  normalizeApplianceCategory,
  resolveApplianceCategoryPair,
} from "@/lib/types";

/** GET /api/appliances/catalog — authenticated; store scoped to actor. */
export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const url = new URL(request.url);
    const store = actorBoundStoreNumber(
      actor,
      url.searchParams.get("store_number") ??
        request.headers.get("x-store-number")
    );
    const { data, error } = await supabase
      .from("appliance_catalog")
      .select("*")
      .eq("store_number", store)
      .order("item_number");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      store_number: store,
      items: (data ?? []).map((row) =>
        mapApplianceCatalogRow(row as Record<string, unknown>)
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

/** POST /api/appliances/catalog — upsert UPC↔Item link with required sub_category */
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
    const db = supabase;

    const body = (await request.json()) as Record<string, unknown>;
    const store = actorBoundStoreNumber(
      actor,
      body.store_number != null ? String(body.store_number) : null
    );
    const item_number = String(body.item_number ?? "").trim();
    const description = String(body.description ?? "").trim();
    const upcRaw = body.upc;
    const upc =
      upcRaw == null || upcRaw === ""
        ? null
        : normalizeApplianceIdentifier(upcRaw) || null;
    const teachIdentifierRaw = body.teach_identifier;
    const teach_identifier =
      teachIdentifierRaw == null || teachIdentifierRaw === ""
        ? upc
        : normalizeApplianceIdentifier(teachIdentifierRaw) || upc;

    const pair = resolveApplianceCategoryPair(
      body.category,
      body.sub_category
    );
    const category = normalizeApplianceCategory(pair.category);
    const sub_category = pair.sub_category;

    if (!item_number) {
      return NextResponse.json(
        { error: "item_number is required" },
        { status: 400 }
      );
    }
    if (!isValidApplianceSubCategory(category, sub_category)) {
      return NextResponse.json(
        { error: "Valid sub_category is required for the selected category" },
        { status: 400 }
      );
    }

    async function findIdentifierOwner(value: string) {
      const { data: idRows, error: idError } = await db
        .from("appliance_catalog_identifiers")
        .select("*")
        .eq("store_number", store)
        .eq("identifier", value);
      if (idError) throw new Error(idError.message);
      const idHit = (idRows ?? []).find((row) => {
        const rowItem = String(
          (row as { item_number?: string }).item_number ?? ""
        ).trim();
        return rowItem !== item_number;
      });
      if (idHit) return idHit;

      const { data: upcRows, error: upcError } = await db
        .from("appliance_catalog")
        .select("*")
        .eq("store_number", store)
        .eq("upc", value);
      if (upcError) throw new Error(upcError.message);
      const bodyId = body.id ? String(body.id) : "";
      return (upcRows ?? []).find((row) => {
        const rowItem = String(
          (row as { item_number?: string }).item_number ?? ""
        ).trim();
        const rowId = String((row as { id?: string }).id ?? "");
        if (bodyId && rowId === bodyId) return false;
        if (rowItem === item_number) return false;
        return true;
      });
    }

    // Application-layer identifier uniqueness (DB unique on identifiers table).
    const checkValues = [upc, teach_identifier].filter(
      (v, i, arr): v is string => Boolean(v) && arr.indexOf(v) === i
    );
    for (const value of checkValues) {
      let conflict: unknown;
      try {
        conflict = await findIdentifierOwner(value);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Lookup failed" },
          { status: 500 }
        );
      }
      if (conflict) {
        const owner = String(
          (conflict as { item_number?: string }).item_number ?? "?"
        ).trim();
        return NextResponse.json(
          {
            error: `Identifier ${value} is already linked to Item ${owner}. Clear or change that mapping first.`,
            conflict,
          },
          { status: 409 }
        );
      }
    }

    const now = new Date().toISOString();
    const payload = {
      id: body.id ? String(body.id) : undefined,
      store_number: store,
      item_number,
      upc,
      description,
      category,
      sub_category,
      updated_at: now,
      ...(body.id ? {} : { created_at: now }),
    };

    const { data, error } = await supabase
      .from("appliance_catalog")
      .upsert(payload, { onConflict: "store_number,item_number" })
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (teach_identifier) {
      const { error: idInsertError } = await supabase
        .from("appliance_catalog_identifiers")
        .insert({
          store_number: store,
          item_number,
          identifier: teach_identifier,
          updated_at: now,
          created_at: now,
        });
      if (idInsertError) {
        if (/duplicate|unique/i.test(idInsertError.message)) {
          const { data: existing } = await supabase
            .from("appliance_catalog_identifiers")
            .select("item_number")
            .eq("store_number", store)
            .eq("identifier", teach_identifier)
            .maybeSingle();
          const owner = String(
            (existing as { item_number?: string } | null)?.item_number ?? ""
          ).trim();
          if (owner && owner !== item_number) {
            return NextResponse.json(
              {
                error: `Identifier ${teach_identifier} is already linked to Item ${owner}.`,
              },
              { status: 409 }
            );
          }
          // Same-item idempotent teach — OK.
        } else if (/foreign/i.test(idInsertError.message)) {
          return NextResponse.json(
            { error: idInsertError.message },
            { status: 400 }
          );
        } else {
          return NextResponse.json(
            { error: idInsertError.message },
            { status: 500 }
          );
        }
      }
    }

    const item = mapApplianceCatalogRow(
      (data ?? payload) as Record<string, unknown>
    );
    if (teach_identifier) {
      item.identifiers = Array.from(
        new Set([...(item.identifiers ?? []), teach_identifier])
      );
    }

    return NextResponse.json({ item });
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

/** DELETE /api/appliances/catalog?id=&store_number= */
export async function DELETE(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const url = new URL(request.url);
    const id = url.searchParams.get("id")?.trim();
    const store = actorBoundStoreNumber(
      actor,
      url.searchParams.get("store_number")
    );
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("appliance_catalog")
      .delete()
      .eq("id", id)
      .eq("store_number", store);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
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
