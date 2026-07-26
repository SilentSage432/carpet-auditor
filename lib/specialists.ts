import { uid } from "./uid";
import type { StoreSpecialist } from "./types";
import { getSupabase } from "./supabase";

const STORAGE_KEY = "carpet_specialists_offline";
const ACTIVE_KEY = "carpet_active_specialist";
const TABLE = "store_specialists";

const SEED: StoreSpecialist[] = [
  {
    id: "seed-alex",
    name: "Alex",
    role: "Specialist",
    created_at: new Date(0).toISOString(),
    offline: true,
  },
  {
    id: "seed-dave",
    name: "Dave",
    role: "Specialist",
    created_at: new Date(0).toISOString(),
    offline: true,
  },
];

function readLocal(): StoreSpecialist[] {
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

function writeLocal(records: StoreSpecialist[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function mapRow(row: Record<string, unknown>): StoreSpecialist {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    role: String(row.role ?? "Specialist"),
    created_at: String(row.created_at ?? new Date().toISOString()),
    offline: Boolean(row.offline),
  };
}

function upsertLocal(record: StoreSpecialist): StoreSpecialist[] {
  const existing = readLocal().filter(
    (r) => r.id !== record.id && r.name.toLowerCase() !== record.name.toLowerCase()
  );
  const next = [record, ...existing].sort((a, b) => a.name.localeCompare(b.name));
  writeLocal(next);
  return next;
}

export function getActiveSpecialist(): StoreSpecialist | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    return mapRow(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function setActiveSpecialist(specialist: StoreSpecialist | null): void {
  if (typeof window === "undefined") return;
  if (!specialist) {
    localStorage.removeItem(ACTIVE_KEY);
    return;
  }
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(specialist));
}

export async function fetchSpecialists(): Promise<StoreSpecialist[]> {
  const local = readLocal();
  const supabase = getSupabase();

  if (!supabase) {
    return local.length > 0 ? local : SEED;
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;

    const remote = (data ?? []).map((row) =>
      mapRow({ ...(row as Record<string, unknown>), offline: false })
    );
    const remoteNames = new Set(remote.map((r) => r.name.toLowerCase()));
    const offlineOnly = local.filter(
      (r) => r.offline && !remoteNames.has(r.name.toLowerCase())
    );

    const merged = [...offlineOnly, ...remote].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    return merged.length > 0 ? merged : SEED;
  } catch {
    return local.length > 0 ? local : SEED;
  }
}

export async function saveSpecialist(input: {
  id?: string;
  name: string;
  role?: string;
}): Promise<{ record: StoreSpecialist; offline: boolean }> {
  const now = new Date().toISOString();
  const record: StoreSpecialist = {
    id: input.id ?? uid(),
    name: input.name.trim(),
    role: (input.role ?? "Specialist").trim() || "Specialist",
    created_at: now,
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
      .upsert(
        {
          id: record.id,
          name: record.name,
          role: record.role,
          created_at: record.created_at,
        },
        { onConflict: "name" }
      )
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
