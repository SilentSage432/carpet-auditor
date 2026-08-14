import { uid } from "./uid";
import type {
  DepartmentScope,
  SpecialistRole,
  StoreSpecialist,
} from "./types";
import { departmentMeta } from "./types";
import { getStoreNumber, normalizeStoreNumber } from "./store";
import { getSupabase } from "./supabase";
import { normalizePhoneE164 } from "./phone";
import {
  enqueueSyncAction,
  shouldSaveOffline,
} from "./sync-queue";

const STORAGE_KEY = "carpet_specialists_offline";
const ACTIVE_KEY = "carpet_active_specialist";
const TABLE = "store_specialists";

/** Roster list columns — never pin_code or temp_pin_hash. */
const SPECIALIST_LIST_SELECT = [
  "id",
  "store_number",
  "name",
  "role",
  "username",
  "assigned_department",
  "must_change_credentials",
  "must_change_pin",
  "phone_number",
  "is_active",
  "created_at",
].join(", ");

export const DEFAULT_SUPERVISOR_PIN = "1234";
export const DEFAULT_APPLIANCE_USERNAME = "amber_appliance";
/** Legacy Amber password — blocked on credential customize, not used for seeding. */
export const DEFAULT_APPLIANCE_PASSWORD = "ChangeMe123";

const PLACEHOLDER_NAMES = new Set([
  "alex",
  "dave",
  "sales specialist 1",
  "sales specialist 2",
  "specialist 1",
  "specialist 2",
]);

function normalizeRole(raw: unknown): SpecialistRole {
  const value = String(raw ?? "").toLowerCase().trim();
  if (
    value === "masteradmin" ||
    value === "master_admin" ||
    value === "master admin" ||
    value.includes("master")
  ) {
    return "MasterAdmin";
  }
  if (
    value.includes("supervisor") ||
    value.includes("manager") ||
    value === "dept supervisor"
  ) {
    return "Supervisor";
  }
  return "Associate";
}

function normalizeDepartment(raw: unknown, role: SpecialistRole): DepartmentScope | null {
  const value = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  if (
    value === "lawn_and_garden" ||
    value === "lawn" ||
    value === "garden" ||
    value === "outdoor"
  ) {
    return "lawn_garden";
  }
  if (value === "bldg_materials" || value === "lumber" || value === "building") {
    return "building_materials";
  }
  if (value === "appliance") return "appliances";
  if (value === "carpet") return "flooring";
  if (value === "*") return "all";
  if (
    value === "flooring" ||
    value === "appliances" ||
    value === "plumbing" ||
    value === "electrical" ||
    value === "lawn_garden" ||
    value === "paint" ||
    value === "millwork" ||
    value === "building_materials" ||
    value === "hardware" ||
    value === "all"
  ) {
    return value;
  }
  if (role === "MasterAdmin") return "all";
  return null;
}

export function mapRow(row: Record<string, unknown>): StoreSpecialist {
  const pinRaw = row.pin_code ?? row.pin;
  const pin =
    pinRaw == null || String(pinRaw).trim() === ""
      ? null
      : String(pinRaw).trim();
  const role = normalizeRole(row.role);
  const usernameRaw = row.username;
  const username =
    usernameRaw == null || String(usernameRaw).trim() === ""
      ? null
      : String(usernameRaw).trim();

  let assigned = normalizeDepartment(row.assigned_department, role);
  if (!assigned && role === "Supervisor") {
    const hint = `${row.name ?? ""} ${username ?? ""}`;
    if (/appliance/i.test(hint) || /amber/i.test(hint)) {
      assigned = "appliances";
    } else {
      assigned = "flooring";
    }
  }
  if (!assigned && role === "MasterAdmin") assigned = "all";

  const mustChange =
    row.must_change_credentials === true ||
    row.must_change_credentials === "true" ||
    row.must_change_credentials === 1 ||
    row.must_change_pin === true ||
    row.must_change_pin === "true" ||
    row.must_change_pin === 1;

  const isActiveRaw = row.is_active;
  const isActive =
    isActiveRaw === false ||
    isActiveRaw === "false" ||
    isActiveRaw === 0
      ? false
      : true;

  const phoneRaw = row.phone_number;
  const phone =
    phoneRaw == null || String(phoneRaw).trim() === ""
      ? null
      : String(phoneRaw).trim();

  return {
    id: String(row.id),
    store_number: String(row.store_number ?? getStoreNumber()),
    name: String(row.name ?? ""),
    role,
    pin_code: pin,
    username,
    assigned_department: assigned,
    must_change_credentials: Boolean(mustChange),
    must_change_pin: Boolean(
      row.must_change_pin === true ||
        row.must_change_pin === "true" ||
        row.must_change_pin === 1
    ),
    phone_number: phone,
    is_active: isActive,
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

/** Drop legacy offline seed profiles (seed-master-admin-*, Amber, etc.). */
function isHardcodedSeedProfile(member: StoreSpecialist): boolean {
  const id = String(member.id ?? "").toLowerCase();
  if (id.startsWith("seed-")) return true;
  if (id.startsWith("default-")) return true;
  return false;
}

function preferSpecialist(a: StoreSpecialist, b: StoreSpecialist): StoreSpecialist {
  if (a.offline && !b.offline) return b;
  if (!a.offline && b.offline) return a;
  const aSeed = isHardcodedSeedProfile(a);
  const bSeed = isHardcodedSeedProfile(b);
  if (aSeed && !bSeed) return b;
  if (!aSeed && bSeed) return a;
  const aCustom = a.pin_code && a.pin_code !== DEFAULT_SUPERVISOR_PIN;
  const bCustom = b.pin_code && b.pin_code !== DEFAULT_SUPERVISOR_PIN;
  if (!aCustom && bCustom) return b;
  if (aCustom && !bCustom) return a;
  return new Date(a.created_at).getTime() >= new Date(b.created_at).getTime() ? a : b;
}

function isGenericFlooringSupervisorName(name: string): boolean {
  const n = name.toLowerCase().trim();
  return (
    n === "department supervisor" ||
    n === "dept supervisor" ||
    n === "flooring supervisor"
  );
}

function rosterKey(member: StoreSpecialist): string {
  if (member.role === "MasterAdmin") {
    return `__master__:${member.store_number}`;
  }
  if (member.role === "Supervisor") {
    const dept = member.assigned_department ?? "flooring";
    return `__supervisor__:${member.store_number}:${dept}`;
  }
  return `name:${member.store_number}:${member.name.toLowerCase().trim()}`;
}

/** Collapse duplicate master/supervisor-per-dept / same-name cards. */
export function dedupeRoster(roster: StoreSpecialist[]): StoreSpecialist[] {
  const byKey = new Map<string, StoreSpecialist>();

  for (const member of roster) {
    if (!member.name.trim() || isPlaceholder(member)) continue;

    const key = rosterKey(member);
    const existing = byKey.get(key);
    if (!existing) {
      const normalized: StoreSpecialist = { ...member };
      if (
        member.role === "Supervisor" &&
        isGenericFlooringSupervisorName(member.name) &&
        (member.assigned_department === "flooring" || !member.assigned_department)
      ) {
        normalized.name = "Flooring Supervisor";
        normalized.assigned_department = "flooring";
        normalized.role = "Supervisor";
      }
      byKey.set(key, normalized);
    } else {
      const winner = preferSpecialist(existing, member);
      const inactive =
        existing.is_active === false || member.is_active === false;
      byKey.set(key, {
        ...winner,
        role:
          existing.role === "MasterAdmin" || winner.role === "MasterAdmin"
            ? "MasterAdmin"
            : winner.role,
        assigned_department:
          winner.assigned_department ?? existing.assigned_department,
        is_active: inactive ? false : winner.is_active !== false,
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const rank = (m: StoreSpecialist) =>
      m.role === "MasterAdmin" ? 0 : m.role === "Supervisor" ? 1 : 2;
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Normalize a store roster from DB + local cache.
 * Does NOT inject hardcoded Master Admin / Amber / Flooring Supervisor seeds.
 */
function normalizeStoreRoster(
  roster: StoreSpecialist[],
  store = getStoreNumber()
): StoreSpecialist[] {
  const scoped = roster.filter((m) => m.store_number === store);
  return dedupeRoster(
    scoped.filter((m) => !isPlaceholder(m) && !isHardcodedSeedProfile(m))
  );
}

/** Active roster only — deactivated profiles stay in storage as tombstones. */
export function activeSpecialistsOnly(
  roster: StoreSpecialist[]
): StoreSpecialist[] {
  return roster.filter((m) => m.is_active !== false);
}

function sameSpecialistIdentity(
  a: StoreSpecialist,
  b: StoreSpecialist
): boolean {
  if (String(a.id) === String(b.id)) return true;
  if (rosterKey(a) === rosterKey(b)) return true;
  const aUser = a.username?.trim().toLowerCase() ?? "";
  const bUser = b.username?.trim().toLowerCase() ?? "";
  if (aUser && bUser && aUser === bUser && a.store_number === b.store_number) {
    return true;
  }
  return (
    a.store_number === b.store_number &&
    a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
    a.role === b.role
  );
}

export function isDefaultPin(member: StoreSpecialist): boolean {
  const pin = member.pin_code?.trim();
  if (!pin) return member.role === "Supervisor" || member.role === "MasterAdmin";
  if (pin === DEFAULT_SUPERVISOR_PIN) return true;
  if (
    member.username === DEFAULT_APPLIANCE_USERNAME &&
    pin === DEFAULT_APPLIANCE_PASSWORD
  ) {
    return true;
  }
  return false;
}

/** True when first-login credential customization is required (DB flag only). */
export function needsCredentialSetup(member: StoreSpecialist): boolean {
  return Boolean(member.must_change_credentials || member.must_change_pin);
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
  return normalizeStoreRoster(
    readAllLocal().filter((r) => r.store_number === store),
    store
  );
}

function writeLocal(records: StoreSpecialist[], store = getStoreNumber()): void {
  const others = readAllLocal().filter(
    (r) => r.store_number !== store && !isHardcodedSeedProfile(r)
  );
  const scoped = normalizeStoreRoster(records, store);
  writeAllLocal([...others, ...scoped]);
}

function upsertLocal(record: StoreSpecialist): StoreSpecialist[] {
  const store = record.store_number;
  const existing = readLocal(store).filter((r) => {
    if (r.id === record.id) return false;
    if (
      r.name.toLowerCase() === record.name.toLowerCase() &&
      r.role === record.role &&
      (r.assigned_department ?? null) === (record.assigned_department ?? null)
    ) {
      return false;
    }
    return true;
  });
  const next = normalizeStoreRoster([record, ...existing], store);
  writeLocal(next, store);
  return next;
}

export function isSupervisor(member: StoreSpecialist | null | undefined): boolean {
  return member?.role === "Supervisor" || member?.role === "MasterAdmin";
}

export function requiresPin(member: StoreSpecialist): boolean {
  if (member.role === "Supervisor" || member.role === "MasterAdmin") return true;
  return Boolean(member.pin_code && member.pin_code.length > 0);
}

/** True when unlock should use a text password field (non-digit secrets). */
export function usesPasswordUnlock(member: StoreSpecialist): boolean {
  if (member.username?.trim()) return true;
  const secret = member.pin_code?.trim() ?? "";
  if (!secret) return false;
  return !/^\d+$/.test(secret);
}

export function verifyPin(member: StoreSpecialist, pin: string): boolean {
  const expected =
    member.pin_code && member.pin_code.trim().length > 0
      ? member.pin_code.trim()
      : DEFAULT_SUPERVISOR_PIN;
  return pin === expected;
}

/** True when the member can unlock via a 4-digit PIN keypad. */
export function hasQuickPin(member: StoreSpecialist): boolean {
  const secret = member.pin_code?.trim() ?? "";
  if (!secret) {
    // Roster list no longer includes pin_code — username logins use the password field.
    return !Boolean(member.username?.trim());
  }
  return /^\d{4}$/.test(secret);
}

/**
 * Username + password/PIN login against the store roster (local + Supabase-backed).
 * Matches username (case-insensitive), Master Admin aliases, or display name.
 * PIN secrets are not on the list payload — Hub-bridge verifies the PIN.
 */
export function findSpecialistByLogin(
  roster: StoreSpecialist[],
  usernameRaw: string,
  passwordRaw: string
): StoreSpecialist | null {
  const username = usernameRaw.trim().toLowerCase();
  const password = passwordRaw.trim();
  if (!username || !password) return null;

  const aliases = new Set([username]);
  if (username === "admin" || username === "master" || username === "masteradmin") {
    aliases.add("master_admin");
  }

  const candidates = roster.filter((m) => {
    if (m.is_active === false) return false;
    const uname = m.username?.trim().toLowerCase() ?? "";
    const name = m.name.trim().toLowerCase();
    if (uname && aliases.has(uname)) return true;
    if (aliases.has(name)) return true;
    if (aliases.has(name.replace(/\s+/g, "_"))) return true;
    return false;
  });

  for (const member of candidates) {
    if (!member.pin_code) return member;
    if (verifyPin(member, password)) return member;
  }
  return null;
}

export function roleBadge(member: StoreSpecialist): string {
  if (member.role === "MasterAdmin") return "👑 Master Admin";
  if (member.role === "Supervisor") {
    const dept = member.assigned_department;
    if (dept && dept !== "all") {
      return `🛡️ ${departmentMeta(dept).label} Supervisor`;
    }
    return "🛡️ Department Supervisor";
  }
  return "👤 Floor Associate";
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
    const activeStore = getStoreNumber();
    const memberStore = normalizeStoreNumber(String(member.store_number ?? ""));
    if (activeStore && memberStore && memberStore !== activeStore) {
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

function specialistPayload(record: StoreSpecialist): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    store_number: record.store_number,
    name: record.name,
    role: record.role,
    pin_code: record.pin_code,
    must_change_credentials: record.must_change_credentials,
    is_active: record.is_active !== false,
    created_at: record.created_at,
  };
  // Only include optional columns when they have real values (avoid undefined writes)
  if (record.username != null && String(record.username).trim() !== "") {
    payload.username = String(record.username).trim();
  }
  if (record.assigned_department !== undefined) {
    payload.assigned_department = record.assigned_department;
  }
  if (record.phone_number != null && String(record.phone_number).trim() !== "") {
    payload.phone_number = String(record.phone_number).trim();
  }
  if (!isFallbackProfileId(record.id)) {
    payload.id = record.id;
  }
  return payload;
}

/**
 * Build a partial DB update from an explicit patch only.
 * Never sends undefined assigned_department / username.
 */
function buildSpecialistDbPatch(
  patch: Partial<
    Pick<
      StoreSpecialist,
      | "pin_code"
      | "username"
      | "must_change_credentials"
      | "name"
      | "assigned_department"
      | "is_active"
      | "phone_number"
      | "must_change_pin"
    >
  >
): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  if (patch.pin_code !== undefined) {
    update.pin_code = patch.pin_code;
  }
  if (
    patch.username !== undefined &&
    patch.username !== null &&
    String(patch.username).trim() !== ""
  ) {
    update.username = String(patch.username).trim();
  }
  if (patch.must_change_credentials !== undefined) {
    update.must_change_credentials = patch.must_change_credentials;
  }
  if (patch.must_change_pin !== undefined) {
    update.must_change_pin = patch.must_change_pin;
  }
  if (patch.name !== undefined && patch.name !== null && String(patch.name).trim() !== "") {
    update.name = String(patch.name).trim();
  }
  if (patch.assigned_department !== undefined) {
    update.assigned_department = patch.assigned_department;
  }
  if (patch.is_active !== undefined) {
    update.is_active = patch.is_active;
  }
  if (patch.phone_number !== undefined) {
    update.phone_number = patch.phone_number;
  }
  return update;
}

export function isDatabaseUuid(id: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
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
    lower.startsWith("supervisor-") ||
    lower.startsWith("default-") ||
    lower.startsWith("local-")
  );
}

export async function fetchSpecialists(): Promise<StoreSpecialist[]> {
  const store = getStoreNumber();
  // Drop legacy hardcoded offline seeds from localStorage on every load.
  const local = readLocal(store);
  writeLocal(local, store);

  const supabase = getSupabase();
  if (!supabase || shouldSaveOffline()) {
    return activeSpecialistsOnly(local);
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(SPECIALIST_LIST_SELECT)
      .eq("store_number", store)
      .order("name", { ascending: true });

    if (error) throw error;

    const remote = (data ?? [])
      .map((row) => {
        const mapped = mapRow({
          ...(row as unknown as Record<string, unknown>),
          offline: false,
        });
        const prev = local.find(
          (r) =>
            String(r.id) === String(mapped.id) ||
            r.name.toLowerCase() === mapped.name.toLowerCase()
        );
        if (!mapped.pin_code && prev?.pin_code) {
          mapped.pin_code = prev.pin_code;
        }
        return mapped;
      })
      .filter((m) => !isPlaceholder(m) && !isHardcodedSeedProfile(m));

    const remoteIds = new Set(remote.map((r) => String(r.id)));
    const remoteNames = new Set(remote.map((r) => r.name.toLowerCase()));
    const offlineOnly = local.filter(
      (r) =>
        r.offline &&
        !remoteIds.has(String(r.id)) &&
        !remoteNames.has(r.name.toLowerCase()) &&
        !isPlaceholder(r) &&
        !isHardcodedSeedProfile(r)
    );

    // Prefer database roster; keep inactive remote rows as tombstones.
    const merged = normalizeStoreRoster(
      [...offlineOnly, ...remote],
      store
    );
    writeLocal(merged, store);
    return activeSpecialistsOnly(merged);
  } catch {
    return activeSpecialistsOnly(local);
  }
}

export async function saveSpecialist(input: {
  id?: string;
  store_number?: string;
  name: string;
  role?: SpecialistRole | string;
  pin_code?: string | null;
  username?: string | null;
  assigned_department?: DepartmentScope | null;
  must_change_credentials?: boolean;
}): Promise<{ record: StoreSpecialist; offline: boolean }> {
  const now = new Date().toISOString();
  const store = input.store_number ?? getStoreNumber();
  const role = normalizeRole(input.role ?? "Associate");
  let pin =
    input.pin_code == null || String(input.pin_code).trim() === ""
      ? null
      : String(input.pin_code).trim();

  if ((role === "Supervisor" || role === "MasterAdmin") && !pin) {
    pin = DEFAULT_SUPERVISOR_PIN;
  }

  const assigned =
    input.assigned_department ??
    normalizeDepartment(input.assigned_department, role) ??
    (role === "MasterAdmin"
      ? "all"
      : role === "Supervisor"
        ? "flooring"
        : null);

  const id =
    input.id && !isFallbackProfileId(input.id) ? input.id : uid();

  const record: StoreSpecialist = {
    id,
    store_number: store,
    name: input.name.trim(),
    role,
    pin_code: pin,
    username:
      input.username == null || String(input.username).trim() === ""
        ? null
        : String(input.username).trim(),
    assigned_department: assigned,
    must_change_credentials: Boolean(input.must_change_credentials),
    is_active: true,
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

/**
 * Persist a new PIN via service-role API (store_specialists + store_profiles upsert).
 * Falls back to local/offline queue when the API is unreachable.
 */
export async function updateSpecialistPin(
  member: StoreSpecialist,
  newPin: string,
  currentPin?: string
): Promise<{ record: StoreSpecialist; offline: boolean }> {
  const pin = newPin.trim();
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("PIN must be exactly 4 digits");
  }

  const store = member.store_number || getStoreNumber();
  const profileLabel =
    member.role === "MasterAdmin"
      ? "Master Admin"
      : member.role === "Supervisor"
        ? "Supervisor"
        : "Profile";

  const nextLocal: StoreSpecialist = {
    ...member,
    pin_code: pin,
    must_change_credentials: false,
    store_number: store,
  };

  if (shouldSaveOffline()) {
    const offlineRecord: StoreSpecialist = { ...nextLocal, offline: true };
    upsertLocal(offlineRecord);
    enqueueSyncAction(
      "upsert_specialist",
      specialistPayload(offlineRecord),
      store
    );
    setActiveSpecialist(offlineRecord);
    return { record: offlineRecord, offline: true };
  }

  try {
    const { getSupabaseAccessToken } = await import("@/lib/supabase/client");
    const token = await getSupabaseAccessToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch("/api/auth/reset-pin", {
      method: "POST",
      headers,
      body: JSON.stringify({
        specialist_id: member.id,
        username: member.username,
        store_number: store || undefined,
        current_pin: currentPin ?? member.pin_code ?? undefined,
        new_pin: pin,
      }),
    });

    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      specialist?: Record<string, unknown>;
    };

    if (!res.ok || !body.specialist) {
      throw new Error(
        body.error || `Could not update ${profileLabel} PIN (${res.status})`
      );
    }

    const saved = mapRow({
      ...body.specialist,
      pin_code: body.specialist.pin_code ?? body.specialist.pin ?? pin,
      offline: false,
    });
    upsertLocal(saved);
    setActiveSpecialist(saved);
    return { record: saved, offline: false };
  } catch (err) {
    console.error("Failed to update PIN:", err);
    if (err instanceof Error && err.message.trim()) throw err;
    throw new Error(`Could not update ${profileLabel} PIN. Please try again.`);
  }
}

/** First-login / supervisor credential customization (username + password + optional phone). */
export async function updateSpecialistCredentials(
  member: StoreSpecialist,
  input: { username: string; password: string; phone?: string | null }
): Promise<{ record: StoreSpecialist; offline: boolean }> {
  const username = input.username.trim();
  const password = input.password.trim();

  if (username.length < 3) {
    throw new Error("Username must be at least 3 characters");
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }
  if (
    username.toLowerCase() === DEFAULT_APPLIANCE_USERNAME &&
    password === DEFAULT_APPLIANCE_PASSWORD
  ) {
    throw new Error("Choose a custom username and password (not the defaults)");
  }
  if (username.toLowerCase() === "master_admin" && password === DEFAULT_SUPERVISOR_PIN) {
    throw new Error("Choose a custom username and password (not the defaults)");
  }

  const patch: Partial<
    Pick<
      StoreSpecialist,
      | "username"
      | "pin_code"
      | "must_change_credentials"
      | "must_change_pin"
      | "phone_number"
    >
  > = {
    username,
    pin_code: password,
    must_change_credentials: false,
    must_change_pin: false,
  };

  if (input.phone !== undefined) {
    const phone = normalizePhoneE164(input.phone);
    if (String(input.phone ?? "").trim() && !phone) {
      throw new Error("Enter a valid mobile phone number");
    }
    patch.phone_number = phone;
  }

  return persistSpecialistFields(member, patch);
}

async function persistSpecialistFields(
  member: StoreSpecialist,
  patch: Partial<
    Pick<
      StoreSpecialist,
      | "pin_code"
      | "username"
      | "must_change_credentials"
      | "must_change_pin"
      | "name"
      | "assigned_department"
      | "phone_number"
    >
  >
): Promise<{ record: StoreSpecialist; offline: boolean }> {
  const store = member.store_number || getStoreNumber();
  const supabase = getSupabase();
  const profileLabel =
    member.role === "MasterAdmin"
      ? "Master Admin"
      : member.role === "Supervisor"
        ? "Supervisor"
        : "Profile";
  const displayName =
    patch.name?.trim() ||
    member.name?.trim() ||
    (member.role === "MasterAdmin"
      ? "Master Admin"
      : member.role === "Supervisor"
        ? "Department Supervisor"
        : "Team Member");

  const nextLocal: StoreSpecialist = {
    ...member,
    ...patch,
    name: displayName,
    store_number: store,
  };

  if (!supabase || shouldSaveOffline()) {
    const offlineRecord: StoreSpecialist = { ...nextLocal, offline: true };
    upsertLocal(offlineRecord);
    enqueueSyncAction(
      "upsert_specialist",
      specialistPayload(offlineRecord),
      store
    );
    setActiveSpecialist(offlineRecord);
    return { record: offlineRecord, offline: true };
  }

  async function findExistingDbId(): Promise<string | null> {
    // 1) Prefer real UUID id — never require username match
    if (isDatabaseUuid(member.id) && !isFallbackProfileId(member.id)) {
      const { data, error } = await supabase!
        .from(TABLE)
        .select("id")
        .eq("id", member.id)
        .eq("store_number", store)
        .maybeSingle();
      if (error) {
        console.error("Failed to resolve specialist by id:", error);
      } else if (data?.id && isDatabaseUuid(String(data.id))) {
        return String(data.id);
      }
    }

    // 2) Master Admin / Supervisor: resolve by role + store (username optional)
    if (member.role === "MasterAdmin" || member.role === "Supervisor") {
      let roleQuery = supabase!
        .from(TABLE)
        .select("id")
        .eq("store_number", store)
        .eq("role", member.role)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1);

      // Narrow supervisors by department when known
      if (
        member.role === "Supervisor" &&
        member.assigned_department &&
        member.assigned_department !== "all"
      ) {
        roleQuery = roleQuery.eq(
          "assigned_department",
          member.assigned_department
        );
      }

      const { data, error } = await roleQuery.maybeSingle();
      if (error) {
        console.error(
          `Failed to resolve ${member.role} by role:`,
          error
        );
      } else if (data?.id && isDatabaseUuid(String(data.id))) {
        return String(data.id);
      }
    }

    // 3) Optional username lookup only when username is actually set
    const username = member.username?.trim();
    if (username) {
      const { data, error } = await supabase!
        .from(TABLE)
        .select("id")
        .eq("store_number", store)
        .eq("username", username)
        .maybeSingle();
      if (error) {
        console.error("Failed to resolve specialist by username:", error);
      } else if (data?.id && isDatabaseUuid(String(data.id))) {
        return String(data.id);
      }
    }

    // 4) Display name as last resort
    {
      const { data, error } = await supabase!
        .from(TABLE)
        .select("id")
        .eq("store_number", store)
        .eq("name", displayName)
        .maybeSingle();
      if (error) {
        console.error("Failed to resolve specialist by name:", error);
      } else if (data?.id && isDatabaseUuid(String(data.id))) {
        return String(data.id);
      }
    }

    return null;
  }

  async function insertProfile(): Promise<StoreSpecialist> {
    const insertRow: Record<string, unknown> = {
      name: displayName,
      role: member.role,
      pin_code: nextLocal.pin_code,
      must_change_credentials: nextLocal.must_change_credentials,
      is_active: nextLocal.is_active !== false,
      store_number: store,
    };
    if (nextLocal.username != null && String(nextLocal.username).trim() !== "") {
      insertRow.username = String(nextLocal.username).trim();
    }
    if (nextLocal.assigned_department !== undefined) {
      insertRow.assigned_department = nextLocal.assigned_department;
    }

    const { data, error } = await supabase!
      .from(TABLE)
      .insert(insertRow)
      .select("*")
      .single();

    if (error || !data) {
      if (error) {
        console.error("Failed to insert specialist profile:", error);
      }

      const { data: existing, error: findErr } = await supabase!
        .from(TABLE)
        .select("id")
        .eq("store_number", store)
        .eq("role", member.role)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (findErr) {
        console.error("Failed to find specialist after insert error:", findErr);
      }

      if (existing?.id && isDatabaseUuid(String(existing.id))) {
        const { data: updated, error: updErr } = await supabase!
          .from(TABLE)
          .update(buildSpecialistDbPatch(patch))
          .eq("id", String(existing.id))
          .select("*")
          .single();
        if (updErr) {
          console.error("Failed to update specialist after insert conflict:", updErr);
          throw new Error(
            updErr.message ||
              `Could not update ${profileLabel} profile in database. Please try again.`
          );
        }
        if (updated) {
          return mapRow({
            ...(updated as Record<string, unknown>),
            offline: false,
          });
        }
      }

      throw new Error(
        error?.message ||
          `Could not update ${profileLabel} profile in database. Please try again.`
      );
    }

    return mapRow({
      ...(data as Record<string, unknown>),
      offline: false,
    });
  }

  try {
    const targetId = await findExistingDbId();
    let saved: StoreSpecialist;

    if (!targetId) {
      saved = await insertProfile();
    } else {
      // Update only patched columns — never require or force assigned_department
      const { data, error } = await supabase
        .from(TABLE)
        .update(buildSpecialistDbPatch(patch))
        .eq("id", targetId)
        .select("*");

      if (error) {
        console.error("Failed to update specialist PIN/profile:", error);
        throw new Error(
          error.message ||
            `Could not update ${profileLabel} profile in database. Please try again.`
        );
      }

      if (!data || data.length === 0) {
        console.error(
          "Failed to update specialist: no row matched id",
          targetId
        );
        saved = await insertProfile();
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
    console.error("Failed to persist specialist fields:", err);
    if (err instanceof Error && err.message.trim()) {
      throw err;
    }
    throw new Error(
      `Could not update ${profileLabel} profile in database. Please try again.`
    );
  }
}

/**
 * Resolve the active profile against the loaded roster.
 * Prefer a real DB Master Admin / Supervisor UUID over seed sessions.
 */
export function syncActiveSpecialistFromRoster(
  roster: StoreSpecialist[]
): StoreSpecialist | null {
  const store = getStoreNumber();
  const saved = getActiveSpecialist();

  if (saved) {
    const matched =
      (!isFallbackProfileId(saved.id)
        ? roster.find((m) => m.id === saved.id)
        : undefined) ??
      roster.find(
        (m) =>
          m.name.toLowerCase() === saved.name.toLowerCase() &&
          m.store_number === (saved.store_number || store) &&
          m.role === saved.role
      ) ??
      roster.find(
        (m) =>
          saved.username &&
          m.username?.toLowerCase() === saved.username.toLowerCase()
      ) ??
      null;

    if (matched) {
      setActiveSpecialist(matched);
      return matched;
    }
    return saved;
  }

  const dbMaster =
    roster.find(
      (m) =>
        m.role === "MasterAdmin" &&
        m.store_number === store &&
        !isFallbackProfileId(m.id)
    ) ?? roster.find((m) => m.role === "MasterAdmin" && !isFallbackProfileId(m.id));

  if (dbMaster) {
    setActiveSpecialist(dbMaster);
    return dbMaster;
  }

  return null;
}

export function findSupervisor(
  roster: StoreSpecialist[]
): StoreSpecialist | undefined {
  return (
    roster.find((m) => m.role === "MasterAdmin" && !isFallbackProfileId(m.id)) ??
    roster.find((m) => m.role === "MasterAdmin") ??
    roster.find((m) => m.role === "Supervisor" && !isFallbackProfileId(m.id)) ??
    roster.find((m) => m.role === "Supervisor")
  );
}

/**
 * Reset to an explicit temporary PIN and force first-login credential change.
 * Prefer Super Admin invite (`/api/admin/invite-supervisor`) so the PIN is
 * cryptographically random and the invite/SMS preview owns delivery.
 */
export async function resetSpecialistCredentials(
  member: StoreSpecialist,
  temporaryPassword: string
): Promise<{ record: StoreSpecialist; offline: boolean }> {
  const pin = temporaryPassword.trim();
  if (pin.length < 4) {
    throw new Error("Temporary PIN must be at least 4 characters");
  }
  return persistSpecialistFields(member, {
    pin_code: pin,
    must_change_credentials: true,
  });
}

/** Update role / department scope (Master Admin roster edit). */
export async function updateSpecialistScope(
  member: StoreSpecialist,
  input: {
    name?: string;
    role?: SpecialistRole;
    assigned_department?: DepartmentScope | null;
    username?: string | null;
  }
): Promise<{ record: StoreSpecialist; offline: boolean }> {
  const role = input.role ?? member.role;
  const assigned =
    role === "MasterAdmin"
      ? "all"
      : (input.assigned_department ??
        member.assigned_department ??
        "flooring");
  const username =
    input.username === undefined
      ? member.username
      : input.username == null || String(input.username).trim() === ""
        ? null
        : String(input.username).trim();

  return saveSpecialist({
    id: member.id,
    store_number: member.store_number,
    name: input.name?.trim() || member.name,
    role,
    pin_code: member.pin_code,
    username,
    assigned_department: assigned,
    must_change_credentials: member.must_change_credentials,
  });
}

function deactivateLocal(
  member: StoreSpecialist,
  store = getStoreNumber()
): StoreSpecialist[] {
  const scoped = readAllLocal().filter(
    (r) => r.store_number === store && !isHardcodedSeedProfile(r)
  );

  // Hardcoded seed / fallback IDs: purge entirely (do not keep as tombstone).
  if (isHardcodedSeedProfile(member) || isFallbackProfileId(member.id)) {
    const next = scoped.filter((r) => !sameSpecialistIdentity(r, member));
    const normalized = normalizeStoreRoster(next, store);
    const others = readAllLocal().filter(
      (r) => r.store_number !== store && !isHardcodedSeedProfile(r)
    );
    writeAllLocal([...others, ...normalized]);
    return normalized;
  }

  let found = false;
  const next = scoped.map((r) => {
    if (sameSpecialistIdentity(r, member)) {
      found = true;
      return { ...r, is_active: false, offline: Boolean(r.offline) };
    }
    return r;
  });
  if (!found) {
    next.push({
      ...member,
      store_number: store,
      is_active: false,
      offline: true,
    });
  }
  const normalized = normalizeStoreRoster(next, store);
  const others = readAllLocal().filter(
    (r) => r.store_number !== store && !isHardcodedSeedProfile(r)
  );
  writeAllLocal([...others, ...normalized]);
  return normalized;
}

/**
 * Deactivate (soft-delete) a specialist. Prefer is_active=false so audit history
 * FKs / name references cannot block removal. Attempt hard DELETE afterward;
 * if Postgres rejects it, soft-delete still stands.
 */
export async function deleteSpecialist(
  member: StoreSpecialist
): Promise<{ offline: boolean; mode: "soft" | "hard" }> {
  const store = member.store_number || getStoreNumber();
  const supabase = getSupabase();
  const targetId = String(member.id);

  deactivateLocal(member, store);

  const active = getActiveSpecialist();
  if (active && sameSpecialistIdentity(active, member)) {
    setActiveSpecialist(null);
  }

  const deactivated: StoreSpecialist = {
    ...member,
    store_number: store,
    is_active: false,
  };

  if (!supabase || shouldSaveOffline() || isFallbackProfileId(member.id)) {
    if (!isFallbackProfileId(member.id)) {
      enqueueSyncAction(
        "delete_specialist",
        { ...specialistPayload(deactivated), id: targetId },
        store
      );
    }
    return { offline: true, mode: "soft" };
  }

  try {
    // Soft-delete first (survives FK constraints from audit name history).
    const { error: softError } = await supabase
      .from(TABLE)
      .update({ is_active: false })
      .eq("id", targetId)
      .eq("store_number", store);

    if (softError) {
      // Column may be missing on older DBs — attempt hard delete.
      const { error: hardError } = await supabase
        .from(TABLE)
        .delete()
        .eq("id", targetId)
        .eq("store_number", store);
      if (hardError) {
        enqueueSyncAction(
          "delete_specialist",
          { ...specialistPayload(deactivated), id: targetId },
          store
        );
        throw new Error(
          softError.message ||
            hardError.message ||
            "Could not remove specialist from the store database"
        );
      }
      return { offline: false, mode: "hard" };
    }

    // Soft-delete applied — try hard delete when no FK blocks it.
    const { error: hardError } = await supabase
      .from(TABLE)
      .delete()
      .eq("id", targetId)
      .eq("store_number", store);

    if (!hardError) {
      return { offline: false, mode: "hard" };
    }

    // FK / policy blocked hard delete — soft-delete is the durable removal.
    return { offline: false, mode: "soft" };
  } catch (err) {
    enqueueSyncAction(
      "delete_specialist",
      { ...specialistPayload(deactivated), id: targetId },
      store
    );
    if (err instanceof Error) throw err;
    throw new Error("Could not remove specialist from the store database");
  }
}
