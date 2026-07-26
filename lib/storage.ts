import { uid } from "./uid";
import type { CarpetAudit, CarpetAuditInsert, LocationType } from "./types";
import { normalizeCategory } from "./types";
import { getStoreNumber } from "./store";
import { getSupabase } from "./supabase";
import {
  enqueueSyncAction,
  shouldSaveOffline,
} from "./sync-queue";

const STORAGE_KEY = "carpet_audits_offline";
const DRAFT_KEY = "carpet_hub_audit_draft";
const TABLE = "carpet_audits";

function readAllLocal(): CarpetAudit[] {
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

function writeAllLocal(records: CarpetAudit[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function forStore(store = getStoreNumber()): CarpetAudit[] {
  return readAllLocal().filter((r) => r.store_number === store);
}

export function upsertLocal(record: CarpetAudit): CarpetAudit[] {
  const existing = readAllLocal().filter((r) => r.id !== record.id);
  const next = [record, ...existing].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  writeAllLocal(next);
  return forStore(record.store_number);
}

export function removeLocal(id: string): CarpetAudit[] {
  const next = readAllLocal().filter((r) => r.id !== id);
  writeAllLocal(next);
  return forStore();
}

export function getLocalAudits(): CarpetAudit[] {
  return forStore();
}

export function countLocalAudits(): number {
  return forStore().length;
}

/** Mid-scan draft — survives refresh / dead-zone reloads. */
export type AuditFormDraft = {
  store_number: string;
  sku: string;
  carpetName: string;
  category: string;
  simsLocation: string;
  location: LocationType;
  wholeInches: string;
  fraction: number;
  rounds: string;
  boxCount: string;
  sqftPerBox: string;
  systemClf: string;
  rollWidth: number | null;
};

export function loadAuditDraft(store = getStoreNumber()): AuditFormDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuditFormDraft;
    if (parsed.store_number !== store) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAuditDraft(draft: AuditFormDraft): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function clearAuditDraft(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(DRAFT_KEY);
}

function mapRow(row: Record<string, unknown>): CarpetAudit {
  const locationType = (row.location_type ?? row.location ?? "sales_floor") as LocationType;
  const fraction = Number(row.measurement_fraction ?? row.fraction ?? 0);
  const whole = Number(row.whole_inches ?? row.measurement_inches ?? 0);
  const clf = Number(row.calculated_clf ?? row.clf ?? 0);
  const systemRaw = row.system_clf;
  const systemClf =
    systemRaw == null || systemRaw === ""
      ? null
      : Number(systemRaw);
  const varianceRaw = row.variance_clf;
  const varianceClf =
    varianceRaw == null || varianceRaw === ""
      ? systemClf == null
        ? null
        : clf - systemClf
      : Number(varianceRaw);
  const boxRaw = row.box_count ?? row.unit_count;
  const boxCount =
    boxRaw == null || boxRaw === ""
      ? null
      : Number(boxRaw);
  const sqftRaw = row.calculated_sqft;
  const calculatedSqft =
    sqftRaw == null || sqftRaw === ""
      ? null
      : Number(sqftRaw);

  return {
    id: String(row.id),
    store_number: String(row.store_number ?? getStoreNumber()),
    sku: String(row.sku ?? ""),
    carpet_name: String(row.carpet_name ?? row.notes ?? ""),
    category: normalizeCategory(row.category),
    sims_location: String(row.sims_location ?? ""),
    location_type: locationType === "top_stock" ? "top_stock" : "sales_floor",
    measurement_inches: whole,
    measurement_fraction: fraction,
    rounds: Number(row.rounds ?? 0),
    calculated_clf: clf,
    box_count: boxCount != null && Number.isFinite(boxCount) ? boxCount : null,
    calculated_sqft:
      calculatedSqft != null && Number.isFinite(calculatedSqft)
        ? calculatedSqft
        : null,
    system_clf: systemClf != null && Number.isFinite(systemClf) ? systemClf : null,
    variance_clf:
      varianceClf != null && Number.isFinite(varianceClf) ? varianceClf : null,
    audited_by: String(row.audited_by ?? ""),
    created_at: String(row.created_at ?? new Date().toISOString()),
    offline: Boolean(row.offline),
  };
}

function auditPayload(record: CarpetAudit) {
  return {
    id: record.id,
    store_number: record.store_number,
    sku: record.sku,
    carpet_name: record.carpet_name,
    category: record.category,
    sims_location: record.sims_location,
    location_type: record.location_type,
    measurement_inches: record.measurement_inches,
    measurement_fraction: record.measurement_fraction,
    rounds: record.rounds,
    calculated_clf: record.calculated_clf,
    box_count: record.box_count,
    calculated_sqft: record.calculated_sqft,
    system_clf: record.system_clf,
    variance_clf: record.variance_clf,
    audited_by: record.audited_by,
    created_at: record.created_at,
  };
}

export async function fetchAudits(): Promise<CarpetAudit[]> {
  const store = getStoreNumber();
  const local = forStore(store);
  const supabase = getSupabase();

  if (!supabase || shouldSaveOffline()) return local;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("store_number", store)
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
  const store = input.store_number ?? getStoreNumber();
  const record: CarpetAudit = {
    id: input.id ?? uid(),
    store_number: store,
    sku: input.sku,
    carpet_name: input.carpet_name,
    category: normalizeCategory(input.category),
    sims_location: input.sims_location ?? "",
    location_type: input.location_type,
    measurement_inches: input.measurement_inches,
    measurement_fraction: input.measurement_fraction,
    rounds: input.rounds,
    calculated_clf: input.calculated_clf,
    box_count: input.box_count ?? null,
    calculated_sqft: input.calculated_sqft ?? null,
    system_clf: input.system_clf ?? null,
    variance_clf: input.variance_clf ?? null,
    audited_by: input.audited_by ?? "",
    created_at: input.created_at ?? now,
    offline: false,
  };

  const supabase = getSupabase();

  if (!supabase || shouldSaveOffline()) {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    enqueueSyncAction("upsert_audit", auditPayload(offlineRecord), store);
    return { record: offlineRecord, offline: true };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .insert(auditPayload(record))
      .select("*")
      .single();

    if (error) throw error;

    const saved = mapRow({ ...(data as Record<string, unknown>), offline: false });
    upsertLocal(saved);
    return { record: saved, offline: false };
  } catch {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    enqueueSyncAction("upsert_audit", auditPayload(offlineRecord), store);
    return { record: offlineRecord, offline: true };
  }
}

export async function deleteAudit(id: string): Promise<void> {
  const store = getStoreNumber();
  removeLocal(id);
  const supabase = getSupabase();
  if (!supabase || shouldSaveOffline()) {
    enqueueSyncAction("delete_audit", { id }, store);
    return;
  }
  try {
    await supabase.from(TABLE).delete().eq("id", id).eq("store_number", store);
  } catch {
    enqueueSyncAction("delete_audit", { id }, store);
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
    "store_number",
    "created_at",
    "sku",
    "carpet_name",
    "category",
    "sims_location",
    "location_type",
    "measurement_inches",
    "measurement_fraction",
    "rounds",
    "calculated_clf",
    "box_count",
    "calculated_sqft",
    "system_clf",
    "variance_clf",
    "audited_by",
  ];

  const escape = (value: string | number | null) => {
    const s = String(value ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const rows = audits.map((a) =>
    [
      a.store_number,
      a.created_at,
      a.sku,
      a.carpet_name,
      a.category,
      a.sims_location,
      a.location_type,
      a.measurement_inches,
      a.measurement_fraction,
      a.rounds,
      a.calculated_clf,
      a.box_count,
      a.calculated_sqft,
      a.system_clf,
      a.variance_clf,
      a.audited_by,
    ]
      .map(escape)
      .join(",")
  );

  return [header.join(","), ...rows].join("\n");
}
