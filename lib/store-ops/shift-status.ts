/**
 * Daily / weekly associate shift board — schedule, on-duty, and call-out.
 * Composes weekly-rotations ShiftRosterMember so Sunday balancer stays in sync.
 * Persists associate_shift_days (work_date + start/end + is_scheduled_today)
 * with localStorage fallback until the migration is applied.
 * Does not own bay assignments.
 */

import { getStoreNumber } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";
import { isoWeekLabel } from "@/lib/store-ops/week";
import {
  hoursBetween,
  mergeShiftRoster,
  readShiftRoster,
  writeShiftRoster,
  type ShiftRosterMember,
} from "@/lib/store-ops/weekly-rotations";
import type { StoreSpecialist } from "@/lib/types";

export const SHIFT_STATUS_EVENT = "deptsync:shift-status";

export type ShiftDutyStatus = "ON_DUTY" | "ABSENT_CALLOUT" | "OFF";

export type AssociateShiftDay = {
  specialist_id: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  is_scheduled_today: boolean;
  is_call_out: boolean;
  status: ShiftDutyStatus;
};

const STORAGE_PREFIX = "deptsync_shift_day";
export const DEFAULT_SHIFT_START = "07:00";
export const DEFAULT_SHIFT_END = "15:30";
const DEFAULT_START = DEFAULT_SHIFT_START;
const DEFAULT_END = DEFAULT_SHIFT_END;

/** Lowe's retail week — Sunday through Saturday (local calendar). */
export const RETAIL_WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

export const RETAIL_WEEKDAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"] as const;

export const SHIFT_CLOCK_PRESETS = [
  { id: "open", label: "Open", start: "07:00", end: "15:30" },
  { id: "mid", label: "Mid", start: "10:00", end: "18:30" },
  { id: "close", label: "Close", start: "14:30", end: "23:00" },
] as const;

export type WeeklyShiftDraft = {
  work_date: string;
  is_scheduled: boolean;
  start_time: string | null;
  end_time: string | null;
};

export function localWorkDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseLocalWorkDate(iso: string): Date {
  const [y, m, d] = String(iso)
    .split("-")
    .map((part) => Number(part));
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

export function addCalendarDays(isoDate: string, days: number): string {
  const dt = parseLocalWorkDate(isoDate);
  dt.setDate(dt.getDate() + days);
  return localWorkDate(dt);
}

/** Sunday YYYY-MM-DD for the retail week containing `from`. */
export function retailWeekStart(from: Date | string = new Date()): string {
  const dt =
    typeof from === "string" ? parseLocalWorkDate(from) : new Date(from);
  const local = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  local.setDate(local.getDate() - local.getDay());
  return localWorkDate(local);
}

export function retailWeekDates(sunday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addCalendarDays(sunday, i));
}

export function formatRetailWeekRange(sunday: string): string {
  const dates = retailWeekDates(sunday);
  const start = parseLocalWorkDate(dates[0] ?? sunday);
  const end = parseLocalWorkDate(dates[6] ?? sunday);
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(start)}–${fmt(end)}`;
}

export function shiftRowKey(specialistId: string, workDate: string): string {
  return `${specialistId}|${workDate}`;
}

export function sliceShiftDaysForDate(
  rows: Record<string, AssociateShiftDay>,
  date: string
): Record<string, AssociateShiftDay> {
  const out: Record<string, AssociateShiftDay> = {};
  for (const row of Object.values(rows)) {
    if (row.work_date === date) out[row.specialist_id] = row;
  }
  return out;
}

export function isScheduledShiftDay(
  row: AssociateShiftDay | null | undefined
): boolean {
  if (!row) return false;
  if (row.status === "OFF") return false;
  return row.is_scheduled_today !== false;
}

export function todayShiftCaption(
  row: AssociateShiftDay | null | undefined
): string {
  if (!isScheduledShiftDay(row)) return "Today: Off";
  return `Today: ${formatShiftPill(row?.start_time, row?.end_time)}`;
}

export function formatShiftPill(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  const a = normalizeClock(start) || DEFAULT_START;
  const b = normalizeClock(end) || DEFAULT_END;
  return `${a} - ${b}`;
}

export function normalizeClock(raw: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  if (!Number.isFinite(min) || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function storageKey(date: string, store = getStoreNumber()): string {
  return `${STORAGE_PREFIX}:${store}:${date}`;
}

function emitShift() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SHIFT_STATUS_EVENT));
}

function deriveStatus(row: {
  is_scheduled_today: boolean;
  is_call_out: boolean;
}): ShiftDutyStatus {
  if (row.is_call_out) return "ABSENT_CALLOUT";
  if (row.is_scheduled_today) return "ON_DUTY";
  return "OFF";
}

function normalizeDay(
  specialistId: string,
  workDate: string,
  raw: unknown
): AssociateShiftDay | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = String(rec.specialist_id ?? specialistId).trim();
  if (!id) return null;
  const is_call_out = rec.is_call_out === true || rec.status === "ABSENT_CALLOUT";
  const is_scheduled_today =
    rec.is_scheduled_today !== false && rec.status !== "OFF";
  const start_time = normalizeClock(
    rec.start_time != null ? String(rec.start_time) : null
  );
  const end_time = normalizeClock(
    rec.end_time != null ? String(rec.end_time) : null
  );
  return {
    specialist_id: id,
    work_date: String(rec.work_date ?? workDate),
    start_time,
    end_time,
    is_scheduled_today: is_call_out ? true : is_scheduled_today,
    is_call_out,
    status: deriveStatus({
      is_scheduled_today: is_call_out ? true : is_scheduled_today,
      is_call_out,
    }),
  };
}

function readLocal(
  date: string,
  store = getStoreNumber()
): Record<string, AssociateShiftDay> {
  if (typeof window === "undefined" || !date) return {};
  try {
    const raw = window.localStorage.getItem(storageKey(date, store));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const map: Record<string, AssociateShiftDay> = {};
    for (const [id, value] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      const row = normalizeDay(id, date, value);
      if (row) map[row.specialist_id] = row;
    }
    return map;
  } catch {
    return {};
  }
}

function writeLocal(
  date: string,
  map: Record<string, AssociateShiftDay>,
  store = getStoreNumber()
): void {
  if (typeof window === "undefined" || !date) return;
  window.localStorage.setItem(storageKey(date, store), JSON.stringify(map));
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

function defaultDay(
  member: StoreSpecialist,
  date: string,
  shift?: ShiftRosterMember
): AssociateShiftDay {
  const start =
    normalizeClock(shift?.start) ||
    (member.role === "MasterAdmin" ? null : DEFAULT_START);
  const end =
    normalizeClock(shift?.end) ||
    (member.role === "MasterAdmin" ? null : DEFAULT_END);
  const is_scheduled_today =
    member.role !== "MasterAdmin" && shift?.active !== false;
  return {
    specialist_id: String(member.id),
    work_date: date,
    start_time: start,
    end_time: end,
    is_scheduled_today,
    is_call_out: false,
    status: deriveStatus({ is_scheduled_today, is_call_out: false }),
  };
}

/** Merge saved day rows onto the live roster (defaults for missing rows). */
export function composeShiftBoard(
  roster: StoreSpecialist[],
  saved: Record<string, AssociateShiftDay>,
  date: string,
  week = isoWeekLabel()
): AssociateShiftDay[] {
  const shifts = mergeShiftRoster(roster, readShiftRoster(week));
  const byId = new Map(shifts.map((row) => [row.specialist_id, row]));
  return roster
    .filter((m) => m.is_active !== false)
    .map((m) => {
      const existing = saved[String(m.id)];
      if (existing) return existing;
      return defaultDay(m, date, byId.get(String(m.id)));
    });
}

export function isOnDutyToday(day: AssociateShiftDay | undefined): boolean {
  return Boolean(day && day.status === "ON_DUTY" && !day.is_call_out);
}

export async function fetchShiftDays(
  date = localWorkDate(),
  store = getStoreNumber()
): Promise<Record<string, AssociateShiftDay>> {
  const local = readLocal(date, store);
  const supabase = getSupabase();
  if (!supabase || !store) return local;
  try {
    const { data, error } = await supabase
      .from("associate_shift_days")
      .select(
        "specialist_id, work_date, start_time, end_time, is_scheduled_today, is_call_out, status"
      )
      .eq("store_number", store)
      .eq("work_date", date);
    if (error) {
      if (isMissingRelation(error)) return local;
      throw new Error(error.message || "Could not load shift board");
    }
    const remote: Record<string, AssociateShiftDay> = { ...local };
    for (const row of data ?? []) {
      const next = normalizeDay(String(row.specialist_id), date, row);
      if (next) remote[next.specialist_id] = next;
    }
    writeLocal(date, remote, store);
    return remote;
  } catch (err) {
    if (isMissingRelation(err)) return local;
    throw err;
  }
}

export async function fetchShiftDaysRange(
  startDate: string,
  endDate: string,
  store = getStoreNumber()
): Promise<Record<string, AssociateShiftDay>> {
  const span: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate && span.length < 31) {
    span.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }

  const merged: Record<string, AssociateShiftDay> = {};
  for (const date of span) {
    for (const row of Object.values(readLocal(date, store))) {
      merged[shiftRowKey(row.specialist_id, row.work_date)] = row;
    }
  }

  const supabase = getSupabase();
  if (!supabase || !store) return merged;
  try {
    const { data, error } = await supabase
      .from("associate_shift_days")
      .select(
        "specialist_id, work_date, start_time, end_time, is_scheduled_today, is_call_out, status"
      )
      .eq("store_number", store)
      .gte("work_date", startDate)
      .lte("work_date", endDate);
    if (error) {
      if (isMissingRelation(error)) return merged;
      throw new Error(error.message || "Could not load weekly schedule");
    }
    const byDate: Record<string, Record<string, AssociateShiftDay>> = {};
    for (const date of span) {
      byDate[date] = readLocal(date, store);
    }
    for (const row of data ?? []) {
      const date = String(row.work_date ?? "");
      const next = normalizeDay(String(row.specialist_id), date, row);
      if (!next) continue;
      merged[shiftRowKey(next.specialist_id, next.work_date)] = next;
      const bucket = byDate[date] ?? {};
      bucket[next.specialist_id] = next;
      byDate[date] = bucket;
    }
    for (const [date, map] of Object.entries(byDate)) {
      writeLocal(date, map, store);
    }
    return merged;
  } catch (err) {
    if (isMissingRelation(err)) return merged;
    throw err;
  }
}

export async function upsertShiftDay(
  patch: Partial<AssociateShiftDay> & { specialist_id: string },
  date = localWorkDate(),
  store = getStoreNumber(),
  week = isoWeekLabel(),
  syncRoster = true
): Promise<AssociateShiftDay> {
  const current = readLocal(date, store);
  const prev = current[patch.specialist_id];
  const scheduled =
    patch.is_scheduled_today ?? prev?.is_scheduled_today ?? true;
  const merged: AssociateShiftDay = {
    specialist_id: patch.specialist_id,
    work_date: date,
    start_time:
      patch.start_time !== undefined
        ? normalizeClock(patch.start_time)
        : (prev?.start_time ?? DEFAULT_START),
    end_time:
      patch.end_time !== undefined
        ? normalizeClock(patch.end_time)
        : (prev?.end_time ?? DEFAULT_END),
    is_scheduled_today: scheduled,
    is_call_out: scheduled
      ? (patch.is_call_out ?? prev?.is_call_out ?? false)
      : false,
    status: "ON_DUTY",
  };
  merged.status = deriveStatus(merged);
  current[merged.specialist_id] = merged;
  writeLocal(date, current, store);

  if (syncRoster) {
    syncShiftRosterMember(merged, week, store);
  }

  const supabase = getSupabase();
  if (supabase && store) {
    const { error } = await supabase.from("associate_shift_days").upsert(
      {
        store_number: store,
        specialist_id: merged.specialist_id,
        work_date: date,
        start_time: merged.start_time,
        end_time: merged.end_time,
        is_scheduled_today: merged.is_scheduled_today,
        is_call_out: merged.is_call_out,
        status: merged.status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_number,specialist_id,work_date" }
    );
    if (error && !isMissingRelation(error)) {
      throw new Error(error.message || "Could not save shift");
    }
  }

  if (syncRoster) emitShift();
  return merged;
}

function syncShiftRosterMember(
  merged: AssociateShiftDay,
  week: string,
  store: string
) {
  const existing = readShiftRoster(week, store);
  const hours =
    hoursBetween(merged.start_time ?? undefined, merged.end_time ?? undefined) ??
    8;
  const nextShift: ShiftRosterMember[] = existing.some(
    (row) => row.specialist_id === merged.specialist_id
  )
    ? existing.map((row) =>
        row.specialist_id === merged.specialist_id
          ? {
              ...row,
              start: merged.start_time ?? row.start,
              end: merged.end_time ?? row.end,
              hours,
              active: merged.status === "ON_DUTY",
            }
          : row
      )
    : [
        ...existing,
        {
          specialist_id: merged.specialist_id,
          specialist_name: "Associate",
          active: merged.status === "ON_DUTY",
          hours,
          start: merged.start_time ?? undefined,
          end: merged.end_time ?? undefined,
        },
      ];
  writeShiftRoster(week, nextShift, store);
}

/** Persist a Sun–Sat matrix. localStorage always; Supabase when migrated. */
export async function upsertShiftWeek(
  specialistId: string,
  drafts: WeeklyShiftDraft[],
  store = getStoreNumber()
): Promise<AssociateShiftDay[]> {
  const today = localWorkDate();
  const saved: AssociateShiftDay[] = [];
  for (const draft of drafts) {
    const row = await upsertShiftDay(
      {
        specialist_id: specialistId,
        start_time: draft.start_time,
        end_time: draft.end_time,
        is_scheduled_today: draft.is_scheduled,
        is_call_out: draft.is_scheduled ? undefined : false,
      },
      draft.work_date,
      store,
      isoWeekLabel(parseLocalWorkDate(draft.work_date)),
      false
    );
    saved.push(row);
  }
  const todayRow = saved.find((row) => row.work_date === today);
  if (todayRow) {
    syncShiftRosterMember(todayRow, isoWeekLabel(), store);
  }
  emitShift();
  return saved;
}
