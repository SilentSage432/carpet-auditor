import { uid } from "./uid";
import type { SpecialistRole, StoreSpecialist } from "./types";
import { getSupabase } from "./supabase";

const STORAGE_KEY = "carpet_specialists_offline";
const ACTIVE_KEY = "carpet_active_specialist";
const TABLE = "store_specialists";

export const DEFAULT_SUPERVISOR_PIN = "1234";

const PLACEHOLDER_NAMES = new Set([
  "alex",
  "dave",
  "sales specialist 1",
  "sales specialist 2",
  "specialist 1",
  "specialist 2",
]);

const SUPERVISOR_SEED: StoreSpecialist = {
  id: "seed-supervisor",
  name: "Department Supervisor",
  role: "Supervisor",
  pin_code: DEFAULT_SUPERVISOR_PIN,
  created_at: new Date(0).toISOString(),
  offline: true,
};

function normalizeRole(raw: unknown): SpecialistRole {
  const value = String(raw ?? "").toLowerCase();
  if (
    value.includes("supervisor") ||
    value.includes("manager") ||
    value === "dept supervisor"
  ) {
    return "Supervisor";
  }
  return "Associate";
}

function mapRow(row: Record<string, unknown>): StoreSpecialist {
  const pinRaw = row.pin_code;
  const pin =
    pinRaw == null || String(pinRaw).trim() === ""
      ? null
      : String(pinRaw).trim();

  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    role: normalizeRole(row.role),
    pin_code: pin,
    created_at: String(row.created_at ?? new Date().toISOString()),
    offline: Boolean(row.offline),
  };
}

function isPlaceholder(member: StoreSpecialist): boolean {
  const name = member.name.toLowerCase().trim();
  if (PLACEHOLDER_NAMES.has(name)) return true;
  if (member.id === "seed-alex" || member.id === "seed-dave") return true;
  return false;
}

function ensureSupervisor(roster: StoreSpecialist[]): StoreSpecialist[] {
  const cleaned = roster.filter((m) => m.name.trim() && !isPlaceholder(m));
  const hasSupervisor = cleaned.some((m) => m.role === "Supervisor");
  if (cleaned.length === 0) return [SUPERVISOR_SEED];
  if (!hasSupervisor) {
    return [SUPERVISOR_SEED, ...cleaned].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }
  return cleaned.sort((a, b) => a.name.localeCompare(b.name));
}

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ensureSupervisor(records)));
}

function upsertLocal(record: StoreSpecialist): StoreSpecialist[] {
  const existing = readLocal().filter(
    (r) => r.id !== record.id && r.name.toLowerCase() !== record.name.toLowerCase()
  );
  const next = ensureSupervisor([record, ...existing]);
  writeLocal(next);
  return next;
}

export function isSupervisor(member: StoreSpecialist | null | undefined): boolean {
  return member?.role === "Supervisor";
}

export function requiresPin(member: StoreSpecialist): boolean {
  if (member.role === "Supervisor") return true;
  return Boolean(member.pin_code && member.pin_code.length > 0);
}

export function verifyPin(member: StoreSpecialist, pin: string): boolean {
  const expected =
    member.pin_code && member.pin_code.length > 0
      ? member.pin_code
      : member.role === "Supervisor"
        ? DEFAULT_SUPERVISOR_PIN
        : null;
  if (!expected) return false;
  return pin === expected;
}

export function roleBadge(member: StoreSpecialist): string {
  return member.role === "Supervisor"
    ? "🛡️ Department Supervisor"
    : "👤 Associate";
}

export function getActiveSpecialist(): StoreSpecialist | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const member = mapRow(JSON.parse(raw) as Record<string, unknown>);
    if (isPlaceholder(member)) {
      localStorage.removeItem(ACTIVE_KEY);
      return null;
    }
    return member;
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
  const local = ensureSupervisor(readLocal());
  writeLocal(local);

  const supabase = getSupabase();
  if (!supabase) return local;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;

    const remote = (data ?? [])
      .map((row) => mapRow({ ...(row as Record<string, unknown>), offline: false }))
      .filter((m) => !isPlaceholder(m));

    const remoteNames = new Set(remote.map((r) => r.name.toLowerCase()));
    const offlineOnly = local.filter(
      (r) => r.offline && !remoteNames.has(r.name.toLowerCase()) && !isPlaceholder(r)
    );

    const merged = ensureSupervisor([...offlineOnly, ...remote]);
    writeLocal(merged);
    return merged;
  } catch {
    return local;
  }
}

export async function saveSpecialist(input: {
  id?: string;
  name: string;
  role?: SpecialistRole | string;
  pin_code?: string | null;
}): Promise<{ record: StoreSpecialist; offline: boolean }> {
  const now = new Date().toISOString();
  const role = normalizeRole(input.role ?? "Associate");
  let pin =
    input.pin_code == null || String(input.pin_code).trim() === ""
      ? null
      : String(input.pin_code).trim();

  if (role === "Supervisor" && !pin) {
    pin = DEFAULT_SUPERVISOR_PIN;
  }

  const record: StoreSpecialist = {
    id: input.id ?? uid(),
    name: input.name.trim(),
    role,
    pin_code: pin,
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
          pin_code: record.pin_code,
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

export async function updateSpecialistPin(
  member: StoreSpecialist,
  newPin: string
): Promise<{ record: StoreSpecialist; offline: boolean }> {
  return saveSpecialist({
    id: member.id,
    name: member.name,
    role: member.role,
    pin_code: newPin.trim(),
  });
}

export function findSupervisor(
  roster: StoreSpecialist[]
): StoreSpecialist | undefined {
  return roster.find((m) => m.role === "Supervisor");
}
