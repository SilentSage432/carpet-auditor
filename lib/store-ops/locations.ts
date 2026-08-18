/**
 * Bulk store location generation + listing helpers (server).
 */

import { isValidAisle, normalizeAisle } from "./aisle";
import {
  expandBayNumbers,
  parseBayNumberingPattern,
} from "./bay-pattern";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError, readableError } from "./errors";
import type {
  BayNumberingPattern,
  BulkGenerateInput,
  LocationWorkflowType,
  StoreLocation,
  StoreLocationType,
} from "./types";
import { parseLocationWorkflowType } from "./types";
import {
  parseCustomDecayDays,
  parseVelocitySeedPreset,
  parseVelocityTier,
  velocitySeedFromPreset,
} from "./velocity";

/** Unique key on public.store_locations — Selling + Topstock per aisle/bay. */
export const STORE_LOCATIONS_ON_CONFLICT =
  "department_id,aisle,bay,type" as const;

/** Collapse numeric aisle padding ("012" → "12") for legacy duplicate detection. */
export function locationDedupeAisleKey(aisle: unknown): string {
  const key = normalizeAisle(aisle);
  if (/^\d+$/.test(key)) return String(Number(key));
  return key;
}

export type DuplicateBayGroup = {
  key: string;
  department_id: string;
  aisle: string;
  bay: number;
  type: StoreLocationType;
  keep: StoreLocation;
  prune: StoreLocation[];
};

function duplicateRank(loc: StoreLocation): number {
  let rank = 0;
  if (loc.is_active !== false) rank += 100;
  if (loc.status === "ASSIGNED") rank += 20;
  if (loc.last_completed_at) rank += 10;
  const completed = Date.parse(String(loc.last_completed_at ?? ""));
  if (Number.isFinite(completed)) rank += Math.min(9, Math.floor(completed / 1e12));
  return rank;
}

function preferCanonical(a: StoreLocation, b: StoreLocation): StoreLocation {
  const rankA = duplicateRank(a);
  const rankB = duplicateRank(b);
  if (rankA !== rankB) return rankA > rankB ? a : b;
  const createdA = Date.parse(String(a.created_at ?? ""));
  const createdB = Date.parse(String(b.created_at ?? ""));
  if (Number.isFinite(createdA) && Number.isFinite(createdB) && createdA !== createdB) {
    return createdA < createdB ? a : b;
  }
  return String(a.id).localeCompare(String(b.id)) <= 0 ? a : b;
}

/**
 * Groups tags that share department + aisle + bay + type (legacy duplicates).
 * Keep the canonical row; callers prune the extras (deactivate / delete).
 */
export function findDuplicateLegacyBays(
  locations: StoreLocation[]
): DuplicateBayGroup[] {
  const buckets = new Map<string, StoreLocation[]>();
  for (const loc of locations) {
    const aisle = locationDedupeAisleKey(loc.aisle);
    const bay = Number(loc.bay) || 0;
    const type: StoreLocationType =
      loc.type === "TOPSTOCK" ? "TOPSTOCK" : "SELLING";
    const key = `${loc.department_id}|${aisle}|${bay}|${type}`;
    const list = buckets.get(key) ?? [];
    list.push(loc);
    buckets.set(key, list);
  }

  const groups: DuplicateBayGroup[] = [];
  for (const [key, rows] of buckets) {
    if (rows.length < 2) continue;
    const keep = rows.reduce((best, row) => preferCanonical(best, row));
    const prune = rows.filter((row) => row.id !== keep.id);
    if (prune.length === 0) continue;
    groups.push({
      key,
      department_id: keep.department_id,
      aisle: locationDedupeAisleKey(keep.aisle),
      bay: Number(keep.bay) || 0,
      type: keep.type === "TOPSTOCK" ? "TOPSTOCK" : "SELLING",
      keep,
      prune,
    });
  }

  return groups.sort((a, b) => {
    const aisleCmp = a.aisle.localeCompare(b.aisle, undefined, { numeric: true });
    if (aisleCmp !== 0) return aisleCmp;
    if (a.bay !== b.bay) return a.bay - b.bay;
    return a.type.localeCompare(b.type);
  });
}

export function pruneIdsFromDuplicateGroups(
  groups: DuplicateBayGroup[]
): string[] {
  return groups.flatMap((group) => group.prune.map((row) => row.id));
}

export function locationIdsInBayRange(
  locations: StoreLocation[],
  opts: {
    departmentId: string;
    aisle: string;
    startBay: number;
    endBay: number;
    pattern?: BayNumberingPattern;
    types?: StoreLocationType[];
  }
): string[] {
  const aisle = normalizeAisle(opts.aisle);
  let bays: Set<number>;
  try {
    bays = new Set(
      expandBayNumbers(opts.startBay, opts.endBay, opts.pattern)
    );
  } catch {
    return [];
  }
  const types =
    opts.types && opts.types.length > 0
      ? new Set(opts.types)
      : null;
  return locations
    .filter((loc) => {
      if (loc.department_id !== opts.departmentId) return false;
      if (normalizeAisle(loc.aisle) !== aisle) return false;
      if (!bays.has(Number(loc.bay) || 0)) return false;
      if (types && !types.has(loc.type === "TOPSTOCK" ? "TOPSTOCK" : "SELLING")) {
        return false;
      }
      return true;
    })
    .map((loc) => loc.id);
}

export function buildBulkLocationRows(
  input: BulkGenerateInput & { store_id: string }
): Array<{
  store_id: string;
  department_id: string;
  aisle: string;
  bay: number;
  type: StoreLocationType;
  status: "PENDING";
  cycle_number: number;
  is_active: true;
  velocity_tier: "standard" | "high" | "critical_hotspot";
  priority_override: boolean;
  custom_decay_days: number;
  workflow_type: LocationWorkflowType;
}> {
  const { store_id, department_id, start_bay, end_bay, types } = input;
  const aisle = normalizeAisle(input.aisle);
  if (!store_id) throw new Error("store_id is required");
  if (!department_id) throw new Error("department_id is required");
  if (!isValidAisle(aisle)) {
    throw new Error("aisle is required (alphanumeric code, e.g. BW, 12, A1)");
  }

  const uniqueTypes = Array.from(
    new Set(
      types.filter(
        (t): t is StoreLocationType => t === "SELLING" || t === "TOPSTOCK"
      )
    )
  );
  if (!uniqueTypes.length) {
    throw new Error("Select at least one location type");
  }

  const bays = expandBayNumbers(
    start_bay,
    end_bay,
    parseBayNumberingPattern(input.bay_pattern)
  );

  const seed = velocitySeedFromPreset(
    parseVelocitySeedPreset(input.velocity_seed)
  );
  const velocity_tier = parseVelocityTier(
    input.velocity_tier ?? seed.velocity_tier
  );
  const priority_override =
    typeof input.priority_override === "boolean"
      ? input.priority_override
      : seed.priority_override;
  const custom_decay_days =
    parseCustomDecayDays(input.custom_decay_days) ?? seed.custom_decay_days;
  const workflow_type = parseLocationWorkflowType(input.workflow_type);

  const rows: Array<{
    store_id: string;
    department_id: string;
    aisle: string;
    bay: number;
    type: StoreLocationType;
    status: "PENDING";
    cycle_number: number;
    is_active: true;
    velocity_tier: "standard" | "high" | "critical_hotspot";
    priority_override: boolean;
    custom_decay_days: number;
    workflow_type: LocationWorkflowType;
  }> = [];

  for (const bay of bays) {
    for (const type of uniqueTypes) {
      rows.push({
        store_id,
        department_id,
        aisle,
        bay,
        type,
        status: "PENDING",
        cycle_number: 1,
        is_active: true,
        velocity_tier,
        priority_override,
        custom_decay_days,
        workflow_type,
      });
    }
  }
  return rows;
}

export async function bulkInsertLocations(
  supabase: SupabaseClient,
  input: BulkGenerateInput & { store_id: string }
): Promise<StoreLocation[]> {
  try {
    let payload: Array<Record<string, unknown>> = buildBulkLocationRows(input);
    const optional = ["workflow_type", "custom_decay_days"] as const;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= optional.length; attempt += 1) {
      const { data, error } = await supabase
        .from("store_locations")
        .upsert(payload, { onConflict: STORE_LOCATIONS_ON_CONFLICT })
        .select("*");
      if (!error) {
        return (data ?? []) as StoreLocation[];
      }
      lastError = error;
      const missing = optional.find((column) =>
        isMissingColumnError(error, column)
      );
      if (!missing) {
        throw new Error(readableError(error, "Bulk location upsert failed"));
      }
      payload = payload.map((row) => {
        const next = { ...row };
        delete next[missing];
        return next;
      });
    }

    throw new Error(
      readableError(lastError, "Bulk location upsert failed")
    );
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(readableError(error, "Bulk location upsert failed"));
  }
}

export async function updateDepartmentWorkflowType(
  supabase: SupabaseClient,
  input: {
    storeId: string;
    departmentId: string;
    workflowType: LocationWorkflowType;
  }
): Promise<number> {
  const { data, error } = await supabase
    .from("store_locations")
    .update({
      workflow_type: input.workflowType,
      updated_at: new Date().toISOString(),
    })
    .eq("store_id", input.storeId)
    .eq("department_id", input.departmentId)
    .select("id");

  if (error) {
    throw new Error(readableError(error, "Could not tag department workflow"));
  }
  return data?.length ?? 0;
}
