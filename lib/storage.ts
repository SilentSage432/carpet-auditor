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
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) => mapRow(row as Record<string, unknown>));
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

/** Normalize new schema + legacy local/remote rows. */
function mapRow(row: Record<string, unknown>): CarpetAudit {
  const locationType = (row.location_type ?? row.location ?? "sales_floor") as LocationType;

  const fraction = Number(row.measurement_fraction ?? row.fraction ?? 0);
  // New schema: measurement_inches = whole inches. Legacy: whole_inches.
  const whole = Number(row.whole_inches ?? row.measurement_inches ?? 0);

  const clf = Number(row.calculated_clf ?? row.clf ?? 0);

  return {
    id: String(row.id),
    sku: String(row.sku ?? ""),
    carpet_name: String(row.carpet_name ?? row.notes ?? ""),
    location_type: locationType === "top_stock" ? "top_stock" : "sales_floor",
    measurement_inches: whole,
    measurement_fraction: fraction,
    rounds: Number(row.rounds ?? 0),
    calculated_clf: clf,
    created_at: String(row.created_at ?? new Date().toISOString()),
    offline: Boolean(row.offline),
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

    const remote = (data ?? []).map((row) =>
      mapRow({ ...(row as Record<string, unknown>), offline: false })
    );
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
    carpet_name: input.carpet_name,
    location_type: input.location_type,
    measurement_inches: input.measurement_inches,
    measurement_fraction: input.measurement_fraction,
    rounds: input.rounds,
    calculated_clf: input.calculated_clf,
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
        carpet_name: record.carpet_name,
        location_type: record.location_type,
        measurement_inches: record.measurement_inches,
        measurement_fraction: record.measurement_fraction,
        rounds: record.rounds,
        calculated_clf: record.calculated_clf,
        created_at: record.created_at,
      })
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

export function auditsToCsv(audits: CarpetAudit[]): string {
  const header = [
    "created_at",
    "sku",
    "carpet_name",
    "location_type",
    "measurement_inches",
    "measurement_fraction",
    "rounds",
    "calculated_clf",
  ];

  const escape = (value: string | number) => {
    const s = String(value);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const rows = audits.map((a) =>
    [
      a.created_at,
      a.sku,
      a.carpet_name,
      a.location_type,
      a.measurement_inches,
      a.measurement_fraction,
      a.rounds,
      a.calculated_clf,
    ]
      .map(escape)
      .join(",")
  );

  return [header.join(","), ...rows].join("\n");
}
