/**
 * Store Operations store registry — resolves hub store_number → stores.id.
 * Owns multi-store scoping for departments, locations, and rotations.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_STORE_NUMBER, normalizeStoreNumber } from "@/lib/store";

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

export async function resolveStoreByNumber(
  supabase: SupabaseClient,
  storeNumber?: string | null
): Promise<StoreRecord> {
  const normalized = normalizeStoreNumber(
    storeNumber?.trim() || DEFAULT_STORE_NUMBER
  );

  const { data: existing, error: existingError } = await supabase
    .from("stores")
    .select("*")
    .eq("store_number", normalized)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing) return existing as StoreRecord;

  const { data: created, error: createError } = await supabase
    .from("stores")
    .upsert(
      {
        store_number: normalized,
        name: `Lowe's #${normalized}`,
        is_active: true,
      },
      { onConflict: "store_number" }
    )
    .select("*")
    .single();

  if (createError) throw new Error(createError.message);

  const store = created as StoreRecord;
  await ensureDepartmentsForStore(supabase, store.id);
  return store;
}

export async function listActiveStores(
  supabase: SupabaseClient
): Promise<StoreRecord[]> {
  const { data, error } = await supabase
    .from("stores")
    .select("*")
    .eq("is_active", true)
    .order("store_number");

  if (error) throw new Error(error.message);

  const stores = (data ?? []) as StoreRecord[];
  if (stores.length > 0) return stores;

  // Safety: always have the default store for cron
  const fallback = await resolveStoreByNumber(supabase, DEFAULT_STORE_NUMBER);
  return [fallback];
}

export async function ensureDepartmentsForStore(
  supabase: SupabaseClient,
  storeId: string
): Promise<void> {
  const rows = DEPARTMENT_TEMPLATES.map((d) => ({
    store_id: storeId,
    name: d.name,
    code: d.code,
    weekly_bay_target: 10,
    is_active: true,
  }));

  const { error } = await supabase.from("departments").upsert(rows, {
    onConflict: "store_id,code",
    ignoreDuplicates: true,
  });

  if (error) throw new Error(error.message);
}
