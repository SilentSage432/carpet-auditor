import { uid } from "./uid";
import type { SpecialistRole, StoreSpecialist } from "./types";
import { getStoreNumber } from "./store";
import { getSupabase } from "./supabase";
import {
  enqueueSyncAction,
  shouldSaveOffline,
} from "./sync-queue";

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

function supervisorSeed(store = getStoreNumber()): StoreSpecialist {
  return {
    id: `seed-supervisor-${store}`,
    store_number: store,
    name: "Department Supervisor",
    role: "Supervisor",
    pin_code: DEFAULT_SUPERVISOR_PIN,
    created_at: new Date(0).toISOString(),
    offline: true,
  };
}

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
    store_number: String(row.store_number ?? getStoreNumber()),
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

function preferSpecialist(a: StoreSpecialist, b: StoreSpecialist): StoreSpecialist {
  if (a.offline && !b.offline) return b;
  if (!a.offline && b.offline) return a;
  const aSeed = a.id.startsWith("seed-");
  const bSeed = b.id.startsWith("seed-");
  if (aSeed && !bSeed) return b;
  if (!aSeed && bSeed) return a;
  const aCustom = a.pin_code && a.pin_code !== DEFAULT_SUPERVISOR_PIN;
  const bCustom = b.pin_code && b.pin_code !== DEFAULT_SUPERVISOR_PIN;
  if (!aCustom && bCustom) return b;
  if (aCustom && !bCustom) return a;
  return new Date(a.created_at).getTime() >= new Date(b.created_at).getTime() ? a : b;
}

function isDepartmentSupervisorName(name: string): boolean {
  const n = name.toLowerCase().trim();
  return n === "department supervisor" || n === "dept supervisor";
}

/** Collapse duplicate supervisors / same-name cards to a single roster entry. */
export function dedupeRoster(roster: StoreSpecialist[]): StoreSpecialist[] {
  const byKey = new Map<string, StoreSpecialist>();

  for (const member of roster) {
    if (!member.name.trim() || isPlaceholder(member)) continue;

    const key =
      member.role === "Supervisor" || isDepartmentSupervisorName(member.name)
        ? `__supervisor__:${member.store_number}`
        : `name:${member.store_number}:${member.name.toLowerCase().trim()}`;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...member,
        name:
          member.role === "Supervisor" || isDepartmentSupervisorName(member.name)
            ? "Department Supervisor"
            : member.name,
        role:
          member.role === "Supervisor" || isDepartmentSupervisorName(member.name)
            ? "Supervisor"
            : member.role,
      });
    } else {
      const winner = preferSpecialist(existing, member);
      byKey.set(key, {
        ...winner,
        name:
          winner.role === "Supervisor" || isDepartmentSupervisorName(winner.name)
            ? "Department Supervisor"
            : winner.name,
        role:
          winner.role === "Supervisor" || isDepartmentSupervisorName(winner.name)
            ? "Supervisor"
            : winner.role,
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.role === "Supervisor" && b.role !== "Supervisor") return -1;
    if (b.role === "Supervisor" && a.role !== "Supervisor") return 1;
    return a.name.localeCompare(b.name);
  });
}

function ensureSupervisor(
  roster: StoreSpecialist[],
  store = getStoreNumber()
): StoreSpecialist[] {
  const scoped = roster.filter((m) => m.store_number === store);
  const cleaned = dedupeRoster(scoped);
  const seed = supervisorSeed(store);
  const hasSupervisor = cleaned.some((m) => m.role === "Supervisor");
  if (cleaned.length === 0) return [seed];
  if (!hasSupervisor) {
    return dedupeRoster([seed, ...cleaned]);
  }
  return cleaned;
}

export function isDefaultPin(member: StoreSpecialist): boolean {
  const pin = member.pin_code?.trim();
  if (!pin) return member.role === "Supervisor";
  return pin === DEFAULT_SUPERVISOR_PIN;
}

const PIN_REMIND_PREFIX = "carpet_pin_remind_later_";

export function wasPinRemindLater(memberId: string): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(`${PIN_REMIND_PREFIX}${memberId}`) === "1";
}

export function setPinRemindLater(memberId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(`${PIN_REMIND_PREFIX}${memberId}`, "1");
}

export function clearPinRemindLater(memberId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(`${PIN_REMIND_PREFIX}${memberId}`);
}

function readAllLocal(): StoreSpecialist[] {
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

function writeAllLocal(records: StoreSpecialist[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function readLocal(store = getStoreNumber()): StoreSpecialist[] {
  return ensureSupervisor(readAllLocal().filter((r) => r.store_number === store), store);
}

function writeLocal(records: StoreSpecialist[], store = getStoreNumber()): void {
  const others = readAllLocal().filter((r) => r.store_number !== store);
  const scoped = ensureSupervisor(records, store);
  writeAllLocal([...others, ...scoped]);
}

function upsertLocal(record: StoreSpecialist): StoreSpecialist[] {
  const store = record.store_number;
  const existing = readLocal(store).filter(
    (r) => r.id !== record.id && r.name.toLowerCase() !== record.name.toLowerCase()
  );
  const next = ensureSupervisor([record, ...existing], store);
  writeLocal(next, store);
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
  // Match stored pin_code; Supervisors (and any blank pin) default to 1234
  const expected =
    member.pin_code && member.pin_code.trim().length > 0
      ? member.pin_code.trim()
      : DEFAULT_SUPERVISOR_PIN;
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
    if (member.store_number !== getStoreNumber()) return null;
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

function specialistPayload(record: StoreSpecialist) {
  return {
    id: record.id,
    store_number: record.store_number,
    name: record.name,
    role: record.role,
    pin_code: record.pin_code,
    created_at: record.created_at,
  };
}

export async function fetchSpecialists(): Promise<StoreSpecialist[]> {
  const store = getStoreNumber();
  const local = readLocal(store);
  writeLocal(local, store);

  const supabase = getSupabase();
  if (!supabase || shouldSaveOffline()) return local;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("store_number", store)
      .order("name", { ascending: true });

    if (error) throw error;

    const remote = (data ?? [])
      .map((row) => mapRow({ ...(row as Record<string, unknown>), offline: false }))
      .filter((m) => !isPlaceholder(m));

    const remoteNames = new Set(remote.map((r) => r.name.toLowerCase()));
    const offlineOnly = local.filter(
      (r) => r.offline && !remoteNames.has(r.name.toLowerCase()) && !isPlaceholder(r)
    );

    const merged = ensureSupervisor([...offlineOnly, ...remote], store);
    writeLocal(merged, store);
    return merged;
  } catch {
    return local;
  }
}

export async function saveSpecialist(input: {
  id?: string;
  store_number?: string;
  name: string;
  role?: SpecialistRole | string;
  pin_code?: string | null;
}): Promise<{ record: StoreSpecialist; offline: boolean }> {
  const now = new Date().toISOString();
  const store = input.store_number ?? getStoreNumber();
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
    store_number: store,
    name: input.name.trim(),
    role,
    pin_code: pin,
    created_at: now,
    offline: false,
  };

  const supabase = getSupabase();
  if (!supabase || shouldSaveOffline()) {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    enqueueSyncAction("upsert_specialist", specialistPayload(offlineRecord), store);
    return { record: offlineRecord, offline: true };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(specialistPayload(record), { onConflict: "store_number,name" })
      .select("*")
      .single();

    if (error) throw error;

    const saved = mapRow({ ...(data as Record<string, unknown>), offline: false });
    upsertLocal(saved);
    return { record: saved, offline: false };
  } catch {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    enqueueSyncAction("upsert_specialist", specialistPayload(offlineRecord), store);
    return { record: offlineRecord, offline: true };
  }
}

function isDatabaseUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id
  );
}

/** Seed / local fallback IDs that are not real Supabase row UUIDs. */
export function isFallbackProfileId(id: string): boolean {
  if (!id || !isDatabaseUuid(id)) return true;
  const lower = id.toLowerCase();
  return (
    lower.startsWith("seed-") ||
    lower.startsWith("sup-") ||
    lower.startsWith("default-") ||
    lower.startsWith("local-")
  );
}

export async function updateSpecialistPin(
  member: StoreSpecialist,
  newPin: string
): Promise<{ record: StoreSpecialist; offline: boolean }> {
  const pin = newPin.trim();
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("PIN must be exactly 4 digits");
  }

  const store = member.store_number || getStoreNumber();
  const supabase = getSupabase();
  const profileLabel =
    member.role === "Supervisor" ? "Supervisor" : "Profile";

  // Offline / unconfigured: persist locally + queue; still update active session.
  if (!supabase || shouldSaveOffline()) {
    const offlineRecord: StoreSpecialist = {
      ...member,
      store_number: store,
      pin_code: pin,
      offline: true,
    };
    upsertLocal(offlineRecord);
    enqueueSyncAction(
      "upsert_specialist",
      specialistPayload(offlineRecord),
      store
    );
    setActiveSpecialist(offlineRecord);
    return { record: offlineRecord, offline: true };
  }

  async function upsertProfile(): Promise<StoreSpecialist> {
    const payload: Record<string, unknown> = {
      name: member.name,
      role: member.role === "Supervisor" ? "Supervisor" : member.role,
      pin_code: pin,
      store_number: store,
      created_at: member.created_at || new Date().toISOString(),
    };
    // Only send a real UUID — never insert seed-/fallback ids into uuid PK
    if (!isFallbackProfileId(member.id)) {
      payload.id = member.id;
    }

    const { data, error } = await supabase!
      .from(TABLE)
      .upsert(payload, { onConflict: "store_number,name" })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(
        `Could not update ${profileLabel} profile in database. Please try again.`
      );
    }

    return mapRow({
      ...(data as Record<string, unknown>),
      offline: false,
    });
  }

  try {
    let targetId: string | null = null;

    if (!isFallbackProfileId(member.id)) {
      const { data: byId } = await supabase
        .from(TABLE)
        .select("id")
        .eq("id", member.id)
        .maybeSingle();
      if (byId?.id) targetId = String(byId.id);
    }

    if (!targetId) {
      const { data: byName, error: findError } = await supabase
        .from(TABLE)
        .select("id")
        .eq("store_number", store)
        .eq("name", member.name)
        .maybeSingle();

      if (findError) {
        throw new Error(
          `Could not update ${profileLabel} profile in database. Please try again.`
        );
      }
      if (byName?.id) targetId = String(byName.id);
    }

    let saved: StoreSpecialist;

    if (!targetId) {
      // No DB row yet — insert/upsert a real Supervisor/Profile record
      saved = await upsertProfile();
    } else {
      const { data, error } = await supabase
        .from(TABLE)
        .update({ pin_code: pin })
        .eq("id", targetId)
        .select("*");

      if (error) {
        throw new Error(
          `Could not update ${profileLabel} profile in database. Please try again.`
        );
      }

      if (!data || data.length === 0) {
        // Update matched zero rows — fall back to upsert
        saved = await upsertProfile();
      } else {
        saved = mapRow({
          ...(data[0] as Record<string, unknown>),
          offline: false,
        });
      }
    }

    upsertLocal(saved);
    setActiveSpecialist(saved);
    return { record: saved, offline: false };
  } catch (err) {
    if (err instanceof Error && err.message.includes("profile in database")) {
      throw err;
    }
    throw new Error(
      `Could not update ${profileLabel} profile in database. Please try again.`
    );
  }
}

/**
 * Resolve the active specialist against the loaded roster and sync
 * localStorage so DB pin_code wins after reloads.
 */
export function syncActiveSpecialistFromRoster(
  roster: StoreSpecialist[]
): StoreSpecialist | null {
  const saved = getActiveSpecialist();
  if (!saved) return null;

  const matched =
    roster.find((m) => m.id === saved.id) ??
    roster.find(
      (m) =>
        m.name.toLowerCase() === saved.name.toLowerCase() &&
        m.store_number === (saved.store_number || getStoreNumber())
    ) ??
    roster.find((m) => m.name.toLowerCase() === saved.name.toLowerCase()) ??
    null;

  if (!matched) return saved;

  setActiveSpecialist(matched);
  return matched;
}

export function findSupervisor(
  roster: StoreSpecialist[]
): StoreSpecialist | undefined {
  return roster.find((m) => m.role === "Supervisor");
}
