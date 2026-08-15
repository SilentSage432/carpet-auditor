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

const DEPARTMENT_TEMPLATES: Array<{
  name: string;
  code: string;
  weekly_bay_target: number;
}> = [
  { name: "Flooring / Home Decor", code: "flooring", weekly_bay_target: 10 },
  { name: "Appliances", code: "appliances", weekly_bay_target: 10 },
  { name: "Plumbing", code: "plumbing", weekly_bay_target: 10 },
  { name: "Electrical", code: "electrical", weekly_bay_target: 10 },
  { name: "Paint", code: "D24P", weekly_bay_target: 10 },
  { name: "Inside Garden", code: "D28I", weekly_bay_target: 10 },
  { name: "Outside Garden", code: "D28O", weekly_bay_target: 10 },
  { name: "Millwork", code: "D30", weekly_bay_target: 10 },
  { name: "Cabinets", code: "D29", weekly_bay_target: 6 },
  { name: "Tools", code: "D25", weekly_bay_target: 10 },
  { name: "Building Materials", code: "building_materials", weekly_bay_target: 10 },
];

/** Unique key on public.stores */
export const STORES_ON_CONFLICT = "store_number" as const;

/** Unique key on public.departments — matches live UNIQUE(store_id, code). */
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
      weekly_bay_target: d.weekly_bay_target,
      // Flooring on by default; other depts paused until Super Admin activates
      is_active: d.code === "flooring",
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
