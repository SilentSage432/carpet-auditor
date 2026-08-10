/**
 * Store Operations store registry — resolves hub store_number → stores.id.
 * Owns multi-store scoping for departments, locations, and rotations.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeStoreNumber } from "@/lib/store";
import { readableError } from "./errors";

export type StoreRecord = {
  id: string;
  store_number: string;
  name: string | null;
  is_active: boolean;
  created_at?: string;
};

const DEPARTMENT_TEMPLATES: Array<{ name: string; code: string }> = [
  { name: "Flooring / Home Decor", code: "flooring" },
  { name: "Appliances", code: "appliances" },
  { name: "Plumbing", code: "plumbing" },
  { name: "Electrical", code: "electrical" },
  { name: "Paint", code: "D24P" },
  { name: "Inside Garden", code: "D28I" },
  { name: "Outside Garden", code: "D28O" },
  { name: "Millwork", code: "D30" },
  { name: "Tools", code: "D25" },
  { name: "Building Materials", code: "building_materials" },
];

/** Unique key on public.stores */
export const STORES_ON_CONFLICT = "store_number" as const;

/**
 * Unique key on public.departments after multi-store.
 * Bare `code` is not unique across stores — conflict target must include store_id.
 */
export const DEPARTMENTS_ON_CONFLICT = "store_id,code" as const;

export async function resolveStoreByNumber(
  supabase: SupabaseClient,
  storeNumber?: string | null
): Promise<StoreRecord> {
  try {
    const normalized = normalizeStoreNumber(storeNumber ?? "");
    if (!normalized) {
      throw new Error("Store number is required");
    }

    const { data: existing, error: existingError } = await supabase
      .from("stores")
      .select("*")
      .eq("store_number", normalized)
      .maybeSingle();

    if (existingError) {
      throw new Error(
        readableError(existingError, "Could not look up store record")
      );
    }
    if (existing) return existing as StoreRecord;

    const payload = {
      store_number: normalized,
      name: `Lowe's #${normalized}`,
      is_active: true as const,
    };

    const { data: created, error: createError } = await supabase
      .from("stores")
      .upsert(payload, { onConflict: STORES_ON_CONFLICT })
      .select("*")
      .single();

    if (createError) {
      throw new Error(
        readableError(createError, "Could not create store record")
      );
    }

    const store = created as StoreRecord;
    await ensureDepartmentsForStore(supabase, store.id);
    return store;
  } catch (error) {
    throw new Error(readableError(error, "Store resolve failed"));
  }
}

export async function listActiveStores(
  supabase: SupabaseClient
): Promise<StoreRecord[]> {
  try {
    const { data, error } = await supabase
      .from("stores")
      .select("*")
      .eq("is_active", true)
      .order("store_number");

    if (error) {
      throw new Error(readableError(error, "Could not list active stores"));
    }

    return (data ?? []) as StoreRecord[];
  } catch (error) {
    throw new Error(readableError(error, "Could not list active stores"));
  }
}

export async function ensureDepartmentsForStore(
  supabase: SupabaseClient,
  storeId: string
): Promise<void> {
  try {
    if (!storeId) throw new Error("store_id is required for department seed");

    const rows = DEPARTMENT_TEMPLATES.map((d) => ({
      store_id: storeId,
      name: d.name,
      code: d.code,
      weekly_bay_target: 10,
      is_active: true as const,
    }));

    const { error } = await supabase.from("departments").upsert(rows, {
      onConflict: DEPARTMENTS_ON_CONFLICT,
      ignoreDuplicates: true,
    });

    if (error) {
      throw new Error(
        readableError(error, "Could not seed departments for store")
      );
    }
  } catch (error) {
    throw new Error(
      readableError(error, "Could not seed departments for store")
    );
  }
}
