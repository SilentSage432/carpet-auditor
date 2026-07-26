import { calculateSquareFeet, calculateSquareYards } from "./calc";
import { uid } from "./uid";
import type { Remnant, RemnantInsert, RemnantStatus } from "./types";
import { getSupabase } from "./supabase";

const STORAGE_KEY = "carpet_remnants_offline";
const TABLE = "carpet_remnants";

function readLocal(): Remnant[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) => mapRow(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

function writeLocal(records: Remnant[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function mapRow(row: Record<string, unknown>): Remnant {
  const width = Number(row.width_ft ?? 12);
  const length = Number(row.length_ft ?? 0);
  const sqFt = Number(row.square_feet ?? calculateSquareFeet(width, length));
  const status = String(row.status ?? "available") as RemnantStatus;

  return {
    id: String(row.id),
    sku: String(row.sku ?? ""),
    carpet_name: String(row.carpet_name ?? ""),
    tag_number: String(row.tag_number ?? ""),
    width_ft: width,
    length_ft: length,
    square_feet: sqFt,
    square_yards: Number(row.square_yards ?? calculateSquareYards(sqFt)),
    location: String(row.location ?? ""),
    notes: String(row.notes ?? ""),
    status:
      status === "reserved" || status === "sold" || status === "available"
        ? status
        : "available",
    reserved_for: String(row.reserved_for ?? ""),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    offline: Boolean(row.offline),
  };
}

function upsertLocal(record: Remnant): Remnant[] {
  const existing = readLocal().filter((r) => r.id !== record.id);
  const next = [record, ...existing].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
  writeLocal(next);
  return next;
}

export function getLocalRemnants(): Remnant[] {
  return readLocal();
}

export function countLocalRemnants(): number {
  return readLocal().length;
}

export async function fetchRemnants(): Promise<Remnant[]> {
  const supabase = getSupabase();
  const local = getLocalRemnants();

  if (!supabase) return local;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const remote = (data ?? []).map((row) =>
      mapRow({ ...(row as Record<string, unknown>), offline: false })
    );
    const remoteIds = new Set(remote.map((r) => r.id));
    const offlineOnly = local.filter((r) => r.offline && !remoteIds.has(r.id));

    return [...offlineOnly, ...remote].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  } catch {
    return local;
  }
}

function buildRemnant(input: RemnantInsert, existing?: Remnant): Remnant {
  const now = new Date().toISOString();
  const width = input.width_ft;
  const length = input.length_ft;
  const sqFt = input.square_feet ?? calculateSquareFeet(width, length);
  const sqYd = input.square_yards ?? calculateSquareYards(sqFt);

  return {
    id: input.id ?? existing?.id ?? uid(),
    sku: input.sku.trim(),
    carpet_name: input.carpet_name.trim(),
    tag_number: input.tag_number.trim(),
    width_ft: width,
    length_ft: length,
    square_feet: sqFt,
    square_yards: sqYd,
    location: input.location.trim(),
    notes: input.notes.trim(),
    status: input.status,
    reserved_for: (input.reserved_for ?? "").trim(),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    offline: false,
  };
}

export async function saveRemnant(
  input: RemnantInsert,
  existing?: Remnant
): Promise<{ record: Remnant; offline: boolean }> {
  const record = buildRemnant(input, existing);
  const supabase = getSupabase();

  if (!supabase) {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    return { record: offlineRecord, offline: true };
  }

  try {
    const payload = {
      id: record.id,
      sku: record.sku,
      carpet_name: record.carpet_name,
      tag_number: record.tag_number,
      width_ft: record.width_ft,
      length_ft: record.length_ft,
      square_feet: record.square_feet,
      square_yards: record.square_yards,
      location: record.location,
      notes: record.notes,
      status: record.status,
      reserved_for: record.reserved_for,
      updated_at: record.updated_at,
      created_at: record.created_at,
    };

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(payload)
      .select("*")
      .single();

    if (error) throw error;

    const saved = mapRow({ ...(data as Record<string, unknown>), offline: false });
    upsertLocal(saved);
    return { record: saved, offline: false };
  } catch {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    return { record: offlineRecord, offline: true };
  }
}

export async function deleteRemnant(id: string): Promise<void> {
  writeLocal(readLocal().filter((r) => r.id !== id));
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from(TABLE).delete().eq("id", id);
  } catch {
    /* local already removed */
  }
}
