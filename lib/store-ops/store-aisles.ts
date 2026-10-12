/**
 * DEPTSYNC-TOPOLOGY-REGISTRY-003 — store_aisles registry ownership.
 *
 * Soft-joins to store_locations by (department_id, normalizeStoreAisleCode(aisle)).
 * Does not invent bay rows. Writes are service-role only via API after MasterAdmin checks.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidAisle, normalizeAisle } from "./aisle";
import { readableError } from "./errors";
import { locationDedupeAisleKey } from "./locations";

export type StoreAisle = {
  id: string;
  store_id: string;
  department_id: string;
  aisle: string;
  display_name: string | null;
  is_active: boolean;
  retired_at: string | null;
  created_at?: string;
  updated_at?: string;
};

export type StoreAisleRegistryInput = {
  id?: string;
  store_id?: string;
  department_id: string;
  aisle: string;
  display_name?: string | null;
  is_active?: boolean;
  retired_at?: string | null;
};

/** SQL `normalize_store_aisle` parity (trim/upper/collapse + digit pad collapse). */
export function normalizeStoreAisleCode(raw: unknown): string {
  return locationDedupeAisleKey(raw);
}

const AISLE_CODE_MAX = 64;
const DISPLAY_NAME_MAX = 80;
/** Letters, digits, hyphen, underscore, slash, period, space (collapsed later). */
const AISLE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_\-/. ]*$/;

export type StoreAisleValidation =
  | { ok: true; aisle: string; display_name: string | null }
  | { ok: false; error: string };

export function validateStoreAisleIdentifier(input: {
  aisle?: unknown;
  display_name?: unknown;
}): StoreAisleValidation {
  if (!isValidAisle(input.aisle)) {
    return { ok: false, error: "Location identifier is required" };
  }
  const aisle = normalizeStoreAisleCode(input.aisle);
  if (!aisle) {
    return { ok: false, error: "Location identifier is required" };
  }
  if (aisle.length > AISLE_CODE_MAX) {
    return {
      ok: false,
      error: `Location identifier must be ${AISLE_CODE_MAX} characters or fewer`,
    };
  }
  if (!AISLE_CODE_PATTERN.test(aisle)) {
    return {
      ok: false,
      error:
        "Use letters, numbers, hyphen, underscore, slash, or period (e.g. 41, SHOW-L, CARPET-WALL)",
    };
  }

  let display_name: string | null = null;
  if (input.display_name != null && String(input.display_name).trim() !== "") {
    display_name = String(input.display_name).trim().replace(/\s+/g, " ");
    if (display_name.length > DISPLAY_NAME_MAX) {
      return {
        ok: false,
        error: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer`,
      };
    }
  }

  return { ok: true, aisle, display_name };
}

export function registryAisleKey(
  departmentId: string,
  aisle: unknown
): string {
  return `${String(departmentId).trim()}:${normalizeStoreAisleCode(aisle)}`;
}

export async function listStoreAisles(
  supabase: SupabaseClient,
  input: {
    storeId: string;
    departmentId?: string | null;
    includeRetired?: boolean;
  }
): Promise<StoreAisle[]> {
  let query = supabase
    .from("store_aisles")
    .select(
      "id, store_id, department_id, aisle, display_name, is_active, retired_at, created_at, updated_at"
    )
    .eq("store_id", input.storeId)
    .order("aisle");

  if (input.departmentId) {
    query = query.eq("department_id", input.departmentId);
  }
  if (!input.includeRetired) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(readableError(error, "Could not load store aisles"));
  }
  return (data ?? []).map(normalizeStoreAisleRow);
}

function normalizeStoreAisleRow(row: Record<string, unknown>): StoreAisle {
  return {
    id: String(row.id ?? ""),
    store_id: String(row.store_id ?? ""),
    department_id: String(row.department_id ?? ""),
    aisle: normalizeStoreAisleCode(row.aisle),
    display_name:
      row.display_name == null || String(row.display_name).trim() === ""
        ? null
        : String(row.display_name).trim(),
    is_active: row.is_active !== false,
    retired_at:
      row.retired_at == null ? null : String(row.retired_at),
    created_at: row.created_at == null ? undefined : String(row.created_at),
    updated_at: row.updated_at == null ? undefined : String(row.updated_at),
  };
}

export class StoreAisleConflictError extends Error {
  readonly status = 409;
  readonly existing: StoreAisle;

  constructor(message: string, existing: StoreAisle) {
    super(message);
    this.name = "StoreAisleConflictError";
    this.existing = existing;
  }
}

/**
 * Create an empty registered location (no bay rows).
 * Does not reactivate a retired row — returns 409 conflict instead.
 */
export async function createStoreAisleRecord(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    department_id: string;
    aisle: string;
    display_name?: string | null;
  }
): Promise<StoreAisle> {
  const validated = validateStoreAisleIdentifier(input);
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  const { data: existing, error: existingError } = await supabase
    .from("store_aisles")
    .select(
      "id, store_id, department_id, aisle, display_name, is_active, retired_at, created_at, updated_at"
    )
    .eq("department_id", input.department_id)
    .eq("aisle", validated.aisle)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      readableError(existingError, "Could not check existing location")
    );
  }
  if (existing) {
    const row = normalizeStoreAisleRow(existing as Record<string, unknown>);
    if (!row.is_active) {
      throw new StoreAisleConflictError(
        `Location ${validated.aisle} exists but is retired. Reactivation is not available in this release.`,
        row
      );
    }
    throw new StoreAisleConflictError(
      `Location ${validated.aisle} already exists in this department`,
      row
    );
  }

  const { data, error } = await supabase
    .from("store_aisles")
    .insert({
      store_id: input.store_id,
      department_id: input.department_id,
      aisle: validated.aisle,
      display_name: validated.display_name,
      is_active: true,
      retired_at: null,
    })
    .select(
      "id, store_id, department_id, aisle, display_name, is_active, retired_at, created_at, updated_at"
    )
    .single();

  if (error) {
    if (/duplicate|unique/i.test(String(error.message ?? ""))) {
      throw new StoreAisleConflictError(
        `Location ${validated.aisle} already exists in this department`,
        {
          id: "",
          store_id: input.store_id,
          department_id: input.department_id,
          aisle: validated.aisle,
          display_name: validated.display_name,
          is_active: true,
          retired_at: null,
        }
      );
    }
    throw new Error(readableError(error, "Could not create location"));
  }

  return normalizeStoreAisleRow(data as Record<string, unknown>);
}

/**
 * After bay writes: ensure a matching active registry row exists.
 * Reactivates a retired registry row when bays are documented (heal path).
 * Never invents bay rows.
 */
export async function ensureStoreAisleForBayWrite(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    department_id: string;
    aisle: unknown;
  }
): Promise<void> {
  const aisle = normalizeStoreAisleCode(input.aisle);
  if (!aisle) return;

  const { data: existing, error: existingError } = await supabase
    .from("store_aisles")
    .select("id, is_active")
    .eq("department_id", input.department_id)
    .eq("aisle", aisle)
    .maybeSingle();

  if (existingError) {
    // Non-fatal for bay path — registry may be absent on older envs.
    console.warn("[store-aisles] ensure lookup failed", existingError.message);
    return;
  }

  if (!existing) {
    const { error } = await supabase.from("store_aisles").insert({
      store_id: input.store_id,
      department_id: input.department_id,
      aisle,
      display_name: null,
      is_active: true,
      retired_at: null,
    });
    if (error && !/duplicate|unique/i.test(String(error.message ?? ""))) {
      console.warn("[store-aisles] ensure insert failed", error.message);
    }
    return;
  }

  if (existing.is_active === false) {
    const { error } = await supabase
      .from("store_aisles")
      .update({ is_active: true, retired_at: null })
      .eq("id", existing.id);
    if (error) {
      console.warn("[store-aisles] ensure reactivate failed", error.message);
    }
  }
}

/** Presentation label: optional display_name, else formatAisleDisplayLabel(code). */
export function storeAisleDisplayLabel(
  aisle: Pick<StoreAisleRegistryInput, "aisle" | "display_name">,
  formatCode: (raw: unknown) => string
): string {
  const named = aisle.display_name?.trim();
  if (named) return named;
  return formatCode(normalizeAisle(aisle.aisle) || aisle.aisle);
}
