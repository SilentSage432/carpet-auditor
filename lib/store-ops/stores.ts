/**
 * Store Operations store registry — resolves hub store_number → stores.id.
 * Owns multi-store scoping for departments, locations, and rotations.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeStoreNumber, storeNumberQueryValues } from "@/lib/store";
import {
  isInvalidUuidError,
  isMissingColumnError,
  isOnConflictMismatch,
  isUniqueViolationError,
  readableError,
} from "./errors";
import type { Department } from "./types";

export type StoreRecord = {
  id: string;
  store_number: string;
  name: string | null;
  is_active: boolean;
  created_at?: string;
};

export const STORE_DEPARTMENT_TEMPLATES: Array<{
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

/** Unique key on public.departments — live DBs may still be UNIQUE(code). */
export const DEPARTMENTS_ON_CONFLICT = "store_id,code" as const;
export const DEPARTMENTS_ON_CONFLICT_CODE = "code" as const;

const STORE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when value is a stores.id UUID — not a Lowe's store number like "2587". */
export function isStoreRecordId(value: string | null | undefined): boolean {
  return Boolean(value && STORE_UUID_RE.test(String(value).trim()));
}

/** Presentation fallback while the departments query is pending or failed. */
export function fallbackDepartments(storeId = ""): Department[] {
  return STORE_DEPARTMENT_TEMPLATES.map((d) => ({
    id: `fallback:${d.code}`,
    store_id: storeId,
    name: d.name,
    code: d.code,
    weekly_bay_target: d.weekly_bay_target,
    is_active: d.code === "flooring",
  }));
}

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
      .in("store_number", storeNumberQueryValues(normalized))
      .limit(1)
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

/**
 * Seed department templates for a store.
 * Upserts with ignoreDuplicates against the live unique index:
 * UNIQUE(store_id, code) when present, otherwise UNIQUE(code) / departments_code_key.
 * Duplicate D29 (or any code) is logged and ignored; callers then SELECT existing rows.
 */
export async function ensureDepartmentsForStore(
  supabase: SupabaseClient,
  storeId: string
): Promise<void> {
  if (!isStoreRecordId(storeId)) {
    console.warn(
      "[ensureDepartmentsForStore] skipped — store_id is not a UUID",
      storeId || "(empty)"
    );
    return;
  }

  const rows = STORE_DEPARTMENT_TEMPLATES.map((d) => ({
    store_id: storeId,
    name: d.name,
    code: d.code,
    weekly_bay_target: d.weekly_bay_target,
    is_active: d.code === "flooring",
  }));

  const conflictTargets = [
    DEPARTMENTS_ON_CONFLICT,
    DEPARTMENTS_ON_CONFLICT_CODE,
  ] as const;

  try {
    for (const onConflict of conflictTargets) {
      const { error } = await supabase.from("departments").upsert(rows, {
        onConflict,
        ignoreDuplicates: true,
      });
      if (!error) return;

      if (isOnConflictMismatch(error)) {
        console.warn(
          `[ensureDepartmentsForStore] onConflict '${onConflict}' does not match live unique index`,
          error
        );
        continue;
      }

      if (isUniqueViolationError(error)) {
        console.warn(
          "[ensureDepartmentsForStore] duplicate key — departments already exist",
          error
        );
        return;
      }

      console.error("[ensureDepartmentsForStore] upsert failed", error);
      return;
    }
  } catch (error) {
    if (isUniqueViolationError(error) || isOnConflictMismatch(error)) {
      console.warn(
        "[ensureDepartmentsForStore] seed conflict — falling back to SELECT",
        error
      );
      return;
    }
    console.error("[ensureDepartmentsForStore] failed", error);
  }
}

/**
 * List departments for a store. Tries stores.id (UUID), then store_number,
 * then unscoped SELECT * (global UNIQUE(code) / departments_code_key).
 */
export async function listDepartmentsForStore(
  supabase: SupabaseClient,
  store: Pick<StoreRecord, "id" | "store_number">
): Promise<Department[]> {
  if (isStoreRecordId(store.id)) {
    const byId = await queryDepartments(supabase, "store_id", store.id);
    if (byId.ok && byId.rows.length > 0) return byId.rows;
    if (byId.ok) {
      const byNumber = store.store_number
        ? await queryDepartments(supabase, "store_number", store.store_number)
        : { ok: true, rows: [] as Department[] };
      if (byNumber.ok && byNumber.rows.length > 0) return byNumber.rows;
    }
  } else if (store.id) {
    console.warn(
      "[listDepartmentsForStore] store.id is not a UUID — trying store_number",
      store.id
    );
  }

  const number = normalizeStoreNumber(store.store_number ?? "");
  if (number) {
    const byNumber = await queryDepartments(supabase, "store_number", number);
    if (byNumber.ok && byNumber.rows.length > 0) return byNumber.rows;
  }

  // Global UNIQUE(code) schema: one row per code, not scoped by store_id.
  const unscoped = await supabase
    .from("departments")
    .select("*")
    .order("name");
  if (unscoped.error) {
    console.error("[listDepartmentsForStore] unscoped SELECT failed", unscoped.error);
    return [];
  }
  const rows = (unscoped.data ?? []) as Department[];
  if (isStoreRecordId(store.id)) {
    const scoped = rows.filter((row) => row.store_id === store.id);
    if (scoped.length > 0) return scoped;
  }
  return rows;
}

async function queryDepartments(
  supabase: SupabaseClient,
  column: "store_id" | "store_number",
  value: string
): Promise<{ ok: boolean; rows: Department[] }> {
  const { data, error } = await supabase
    .from("departments")
    .select("*")
    .eq(column, value)
    .order("name");

  if (!error) {
    return { ok: true, rows: (data ?? []) as Department[] };
  }

  console.error(`[listDepartmentsForStore] ${column} query failed`, error);

  if (
    isInvalidUuidError(error) ||
    isMissingColumnError(error, column)
  ) {
    return { ok: false, rows: [] };
  }

  return { ok: false, rows: [] };
}
