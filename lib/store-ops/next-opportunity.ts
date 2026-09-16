/**
 * TIME-DUTY-003 — next scheduled opportunity for an existing weekly owner.
 *
 * Derived from persisted associate_shift_days + store-local time.
 * Not punch data, not a new ownership record, not another stored column.
 */

import {
  type CurrentAvailabilityShiftInput,
  resolveStoreTimezone,
  storeLocalMinutes,
  storeLocalWorkDate,
} from "./current-availability";
import { isoWeekCalendarRange, isoWeekLabel } from "./week";
import { parseClockMinutes } from "./weekly-rotations";

export const NEXT_OPPORTUNITY_METHOD =
  "schedule-derived-next-opportunity-v1" as const;

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type NextScheduledOpportunity = {
  found: true;
  work_date: string;
  start_time: string;
  end_time: string;
  weekday: string;
  label: string;
  caption: string;
  method: typeof NEXT_OPPORTUNITY_METHOD;
} | {
  found: false;
  reason: "NONE_THIS_WEEK";
  caption: string;
  method: typeof NEXT_OPPORTUNITY_METHOD;
};

export type ComposeNextScheduledOpportunityInput = {
  rows: Array<CurrentAvailabilityShiftInput | null | undefined>;
  now: Date;
  timeZone?: string | null;
  /** ISO week to search. Defaults to the store-local current ISO week. */
  weekLabel?: string | null;
};

export function isoWeekLabelFromStoreDate(ymd: string): string {
  const [y, m, d] = String(ymd)
    .split("-")
    .map((part) => Number(part));
  return isoWeekLabel(new Date(y || 1970, (m || 1) - 1, d || 1, 12, 0, 0));
}

function weekdayShort(ymd: string): string {
  const [y, m, d] = String(ymd)
    .split("-")
    .map((part) => Number(part));
  const day = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1)).getUTCDay();
  return WEEKDAY_SHORT[day] ?? "";
}

function formatClock12(raw: string): string | null {
  const minutes = parseClockMinutes(raw);
  if (minutes == null) return null;
  let hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function isCallOutRow(row: CurrentAvailabilityShiftInput): boolean {
  if (row.is_call_out === true) return true;
  return String(row.status ?? "").toUpperCase() === "ABSENT_CALLOUT";
}

function isExplicitOffRow(row: CurrentAvailabilityShiftInput): boolean {
  if (row.is_scheduled_today === false) return true;
  return String(row.status ?? "").toUpperCase() === "OFF";
}

function noneThisWeek(): NextScheduledOpportunity {
  return {
    found: false,
    reason: "NONE_THIS_WEEK",
    caption: "No remaining scheduled shift this week",
    method: NEXT_OPPORTUNITY_METHOD,
  };
}

function isFutureScheduledRow(
  row: CurrentAvailabilityShiftInput,
  today: string,
  nowMinutes: number,
  inWeek: Set<string>
): { work_date: string; start_time: string; end_time: string; start: number } | null {
  const workDate = String(row.work_date ?? "").trim();
  if (!workDate || !inWeek.has(workDate)) return null;
  if (isCallOutRow(row) || isExplicitOffRow(row)) return null;
  const startRaw = String(row.start_time ?? "").trim();
  const endRaw = String(row.end_time ?? "").trim();
  const start = parseClockMinutes(startRaw);
  const end = parseClockMinutes(endRaw);
  if (start == null || end == null) return null;
  if (workDate < today) return null;
  if (workDate > today) {
    return { work_date: workDate, start_time: startRaw, end_time: endRaw, start };
  }
  if (nowMinutes < start) {
    return { work_date: workDate, start_time: startRaw, end_time: endRaw, start };
  }
  return null;
}

/**
 * Next valid scheduled shift after store-local now, bounded to the current ISO week.
 * Missing/invalid/OFF/call-out rows are not invented as opportunities.
 */
export function composeNextScheduledOpportunity(
  input: ComposeNextScheduledOpportunityInput
): NextScheduledOpportunity {
  const timeZone = resolveStoreTimezone(input.timeZone);
  const today = storeLocalWorkDate(input.now, timeZone);
  const nowMinutes = storeLocalMinutes(input.now, timeZone);
  const weekLabel = input.weekLabel?.trim() || isoWeekLabelFromStoreDate(today);
  const inWeek = new Set(isoWeekCalendarRange(weekLabel).dates);

  const candidates = [];
  for (const row of input.rows) {
    if (!row) continue;
    const next = isFutureScheduledRow(row, today, nowMinutes, inWeek);
    if (next) candidates.push(next);
  }
  candidates.sort((a, b) =>
    a.work_date === b.work_date ? a.start - b.start : a.work_date.localeCompare(b.work_date)
  );
  const first = candidates[0];
  if (!first) return noneThisWeek();
  const clock = formatClock12(first.start_time);
  if (!clock) return noneThisWeek();
  const weekday = weekdayShort(first.work_date);
  const label = `${weekday} ${clock}`;
  return {
    found: true,
    work_date: first.work_date,
    start_time: first.start_time,
    end_time: first.end_time,
    weekday,
    label,
    caption: `Next scheduled: ${label}`,
    method: NEXT_OPPORTUNITY_METHOD,
  };
}

export function countWeeklyOwnership(
  assignments: Record<string, { specialist_id?: string | null } | null | undefined>,
  specialistId: string
): number {
  const id = String(specialistId);
  let count = 0;
  for (const row of Object.values(assignments)) {
    if (String(row?.specialist_id ?? "") === id) count += 1;
  }
  return count;
}
