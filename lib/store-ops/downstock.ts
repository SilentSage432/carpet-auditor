/**
 * Downstock / packdown queue — overhead pulls flagged from Zebra.
 * Persistence: downstock_queue (Supabase) with localStorage fallback.
 * Assignment of pulls composes sunday-audit; this module only owns flags.
 */

import { getStoreNumber } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";

export const DOWNSTOCK_EVENT = "deptsync:downstock-queue";

export type DownstockFlag = {
  rotation_id: string;
  location_id: string;
  note: string;
  flagged_by: string;
  flagged_at: string;
  resolved_at: string | null;
};

export type DownstockMap = Record<string, DownstockFlag>;

const STORAGE_PREFIX = "deptsync_downstock";

function storageKey(week: string, store = getStoreNumber()): string {
  return `${STORAGE_PREFIX}:${store}:${week}`;
}

function emitDownstock() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DOWNSTOCK_EVENT));
}

function readLocal(week: string, store = getStoreNumber()): DownstockMap {
  if (typeof window === "undefined" || !week) return {};
  try {
    const raw = window.localStorage.getItem(storageKey(week, store));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const map: DownstockMap = {};
    for (const [id, value] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      const row = normalizeFlag(id, value);
      if (row) map[id] = row;
    }
    return map;
  } catch {
    return {};
  }
}

function writeLocal(
  week: string,
  map: DownstockMap,
  store = getStoreNumber()
): void {
  if (typeof window === "undefined" || !week) return;
  window.localStorage.setItem(storageKey(week, store), JSON.stringify(map));
}

function normalizeFlag(rotationId: string, raw: unknown): DownstockFlag | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = String(rec.rotation_id ?? rotationId).trim();
  if (!id) return null;
  if (rec.resolved_at) {
    return {
      rotation_id: id,
      location_id: String(rec.location_id ?? "").trim(),
      note: String(rec.note ?? "").trim(),
      flagged_by: String(rec.flagged_by ?? "").trim(),
      flagged_at: String(rec.flagged_at ?? ""),
      resolved_at: String(rec.resolved_at),
    };
  }
  return {
    rotation_id: id,
    location_id: String(rec.location_id ?? "").trim(),
    note: String(rec.note ?? "").trim(),
    flagged_by: String(rec.flagged_by ?? "").trim(),
    flagged_at: String(rec.flagged_at ?? new Date().toISOString()),
    resolved_at: null,
  };
}

function isMissingRelation(error: unknown): boolean {
  const msg = String(
    (error as { message?: string } | null)?.message ?? error ?? ""
  ).toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("could not find the table")
  );
}

export function activeDownstockFlags(map: DownstockMap): DownstockMap {
  const next: DownstockMap = {};
  for (const [id, flag] of Object.entries(map)) {
    if (!flag.resolved_at) next[id] = flag;
  }
  return next;
}

export async function fetchDownstockQueue(
  week: string,
  storeNumber = getStoreNumber(),
  department = "flooring"
): Promise<DownstockMap> {
  const local = readLocal(week, storeNumber);
  const store = String(storeNumber ?? "").trim();
  if (!store || !week) return activeDownstockFlags(local);

  const supabase = getSupabase();
  if (!supabase) return activeDownstockFlags(local);

  try {
    const { data, error } = await supabase
      .from("downstock_queue")
      .select(
        "rotation_id, location_id, note, flagged_by, flagged_at, resolved_at"
      )
      .eq("store_number", store)
      .eq("assigned_week", week)
      .eq("department", department);

    if (error) {
      if (isMissingRelation(error)) return activeDownstockFlags(local);
      throw new Error(error.message || "Could not load downstock queue");
    }

    const remote: DownstockMap = {};
    for (const row of data ?? []) {
      const flag = normalizeFlag(String(row.rotation_id ?? ""), row);
      if (flag) remote[flag.rotation_id] = flag;
    }
    const merged = { ...local, ...remote };
    writeLocal(week, merged, store);
    return activeDownstockFlags(merged);
  } catch (err) {
    if (isMissingRelation(err)) return activeDownstockFlags(local);
    return activeDownstockFlags(local);
  }
}

export async function flagForDownstock(input: {
  week: string;
  rotationId: string;
  locationId?: string;
  note?: string;
  flaggedBy?: string;
  department?: string;
  storeNumber?: string;
}): Promise<DownstockFlag> {
  const store = String(input.storeNumber ?? getStoreNumber()).trim();
  const week = String(input.week ?? "").trim();
  const rotationId = String(input.rotationId ?? "").trim();
  const department = String(input.department ?? "flooring").trim() || "flooring";
  if (!store || !week || !rotationId) {
    throw new Error("Week and bay are required to flag downstock");
  }

  const flag: DownstockFlag = {
    rotation_id: rotationId,
    location_id: String(input.locationId ?? "").trim(),
    note: String(input.note ?? "").trim().slice(0, 160),
    flagged_by: String(input.flaggedBy ?? "").trim(),
    flagged_at: new Date().toISOString(),
    resolved_at: null,
  };

  const map = readLocal(week, store);
  map[rotationId] = flag;
  writeLocal(week, map, store);

  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase.from("downstock_queue").upsert(
      {
        store_number: store,
        department,
        assigned_week: week,
        rotation_id: rotationId,
        location_id: flag.location_id || null,
        note: flag.note,
        flagged_by: flag.flagged_by || null,
        flagged_at: flag.flagged_at,
        resolved_at: null,
        updated_at: flag.flagged_at,
      },
      { onConflict: "store_number,department,assigned_week,rotation_id" }
    );
    if (error && !isMissingRelation(error)) {
      throw new Error(error.message || "Could not flag downstock");
    }
  }

  emitDownstock();
  return flag;
}

export async function clearDownstockFlag(input: {
  week: string;
  rotationId: string;
  department?: string;
  storeNumber?: string;
}): Promise<void> {
  const store = String(input.storeNumber ?? getStoreNumber()).trim();
  const week = String(input.week ?? "").trim();
  const rotationId = String(input.rotationId ?? "").trim();
  const department = String(input.department ?? "flooring").trim() || "flooring";
  if (!store || !week || !rotationId) return;

  const map = readLocal(week, store);
  const existing = map[rotationId];
  if (existing) {
    map[rotationId] = {
      ...existing,
      resolved_at: new Date().toISOString(),
    };
    writeLocal(week, map, store);
  }

  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase
      .from("downstock_queue")
      .update({
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("store_number", store)
      .eq("department", department)
      .eq("assigned_week", week)
      .eq("rotation_id", rotationId);
    if (error && !isMissingRelation(error)) {
      throw new Error(error.message || "Could not clear downstock flag");
    }
  }

  emitDownstock();
}
