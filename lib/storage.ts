import type { CarpetAudit, CarpetAuditInsert, LocationType } from "./types";
import { getSupabase } from "./supabase";

const STORAGE_KEY = "carpet_audits_offline";
const TABLE = "carpet_audits";

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readLocal(): CarpetAudit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CarpetAudit[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(records: CarpetAudit[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function upsertLocal(record: CarpetAudit): CarpetAudit[] {
  const existing = readLocal().filter((r) => r.id !== record.id);
  const next = [record, ...existing].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  writeLocal(next);
  return next;
}

export function removeLocal(id: string): CarpetAudit[] {
  const next = readLocal().filter((r) => r.id !== id);
  writeLocal(next);
  return next;
}

export function getLocalAudits(): CarpetAudit[] {
  return readLocal();
}

function mapRow(row: Record<string, unknown>): CarpetAudit {
  return {
    id: String(row.id),
    sku: String(row.sku),
    location: row.location as LocationType,
    whole_inches: Number(row.whole_inches),
    fraction: Number(row.fraction),
    measurement_inches: Number(row.measurement_inches),
    rounds: Number(row.rounds),
    clf: Number(row.clf),
    created_at: String(row.created_at),
    offline: false,
  };
}

export async function fetchAudits(): Promise<CarpetAudit[]> {
  const supabase = getSupabase();
  const local = getLocalAudits();

  if (!supabase) return local;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const remote = (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
    const remoteIds = new Set(remote.map((r) => r.id));
    const offlineOnly = local.filter((r) => r.offline && !remoteIds.has(r.id));

    return [...offlineOnly, ...remote].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  } catch {
    return local;
  }
}

export async function saveAudit(input: CarpetAuditInsert): Promise<{
  record: CarpetAudit;
  offline: boolean;
}> {
  const now = new Date().toISOString();
  const record: CarpetAudit = {
    id: input.id ?? uid(),
    sku: input.sku,
    location: input.location,
    whole_inches: input.whole_inches,
    fraction: input.fraction,
    measurement_inches: input.measurement_inches,
    rounds: input.rounds,
    clf: input.clf,
    created_at: input.created_at ?? now,
    offline: false,
  };

  const supabase = getSupabase();

  if (!supabase) {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    return { record: offlineRecord, offline: true };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        id: record.id,
        sku: record.sku,
        location: record.location,
        whole_inches: record.whole_inches,
        fraction: record.fraction,
        measurement_inches: record.measurement_inches,
        rounds: record.rounds,
        clf: record.clf,
        created_at: record.created_at,
      })
      .select("*")
      .single();

    if (error) throw error;

    const saved = mapRow(data as Record<string, unknown>);
    upsertLocal({ ...saved, offline: false });
    return { record: saved, offline: false };
  } catch {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    return { record: offlineRecord, offline: true };
  }
}

export async function deleteAudit(id: string): Promise<void> {
  removeLocal(id);

  const supabase = getSupabase();
  if (!supabase) return;

  try {
    await supabase.from(TABLE).delete().eq("id", id);
  } catch {
    // Local already removed; remote delete can retry later if needed.
  }
}

export function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
