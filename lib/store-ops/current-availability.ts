/**
 * TIME-DUTY-002 — schedule-derived current expected availability.
 *
 * Persist schedule evidence. Derive whether someone is expected available
 * right now. Not Lowe's punch/attendance. Does not own weekly assignments.
 */

import {
  DEFAULT_STORE_TIMEZONE,
  normalizeStoreTimezone,
  zonedParts,
} from "./sunday-schedule";
import { parseClockMinutes } from "./weekly-rotations";

export const CURRENT_AVAILABILITY_METHOD =
  "schedule-derived-current-availability-v1" as const;

/** User-facing expected-availability state. Not attendance. */
export type CurrentAvailabilityState =
  | "SCHEDULED_NOW"
  | "LATER_TODAY"
  | "OFF";

export type CurrentAvailabilityReason =
  | "IN_WINDOW"
  | "BEFORE_SHIFT"
  | "AFTER_SHIFT"
  | "OFF_TODAY"
  | "CALLED_OUT"
  | "UNKNOWN";

export type CurrentAvailabilityLabel =
  | "On now"
  | "Later today"
  | "Off"
  | "Called out"
  | "Schedule unknown";

export type CurrentAvailabilityShiftInput = {
  work_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  is_scheduled_today?: boolean | null;
  is_call_out?: boolean | null;
  status?: string | null;
};

export type CurrentAvailability = {
  state: CurrentAvailabilityState;
  reason: CurrentAvailabilityReason;
  label: CurrentAvailabilityLabel;
  method: typeof CURRENT_AVAILABILITY_METHOD;
};

export type ComposeCurrentAvailabilityInput = {
  row: CurrentAvailabilityShiftInput | null | undefined;
  /** Yesterday's persisted row — only used for overnight wrap continuation. */
  previousDay?: CurrentAvailabilityShiftInput | null;
  now: Date;
  timeZone?: string | null;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function off(
  reason: CurrentAvailabilityReason,
  label: CurrentAvailabilityLabel = "Off"
): CurrentAvailability {
  return {
    state: "OFF",
    reason,
    label,
    method: CURRENT_AVAILABILITY_METHOD,
  };
}

function later(): CurrentAvailability {
  return {
    state: "LATER_TODAY",
    reason: "BEFORE_SHIFT",
    label: "Later today",
    method: CURRENT_AVAILABILITY_METHOD,
  };
}

function onNow(): CurrentAvailability {
  return {
    state: "SCHEDULED_NOW",
    reason: "IN_WINDOW",
    label: "On now",
    method: CURRENT_AVAILABILITY_METHOD,
  };
}

export function resolveStoreTimezone(raw?: string | null): string {
  return normalizeStoreTimezone(raw ?? DEFAULT_STORE_TIMEZONE);
}

/** Store-local YYYY-MM-DD for `now` interpreted in `timeZone`. */
export function storeLocalWorkDate(
  now: Date,
  timeZone?: string | null
): string {
  const parts = zonedParts(now, resolveStoreTimezone(timeZone));
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** Minutes from store-local midnight. */
export function storeLocalMinutes(
  now: Date,
  timeZone?: string | null
): number {
  const parts = zonedParts(now, resolveStoreTimezone(timeZone));
  return parts.hour * 60 + parts.minute;
}

export function addStoreLocalCalendarDays(
  isoDate: string,
  days: number
): string {
  const [y, m, d] = String(isoDate)
    .split("-")
    .map((part) => Number(part));
  const utc = Date.UTC(y || 1970, (m || 1) - 1, (d || 1) + days);
  const next = new Date(utc);
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

export function previousStoreLocalWorkDate(
  now: Date,
  timeZone?: string | null
): string {
  return addStoreLocalCalendarDays(storeLocalWorkDate(now, timeZone), -1);
}

function normalizeStatus(row: CurrentAvailabilityShiftInput): string {
  if (row.is_call_out === true) return "ABSENT_CALLOUT";
  const status = String(row.status ?? "").toUpperCase();
  if (status === "ABSENT_CALLOUT" || status === "ON_DUTY" || status === "OFF") {
    return status;
  }
  if (row.is_scheduled_today === false) return "OFF";
  return "ON_DUTY";
}

function isCallOutRow(row: CurrentAvailabilityShiftInput): boolean {
  return normalizeStatus(row) === "ABSENT_CALLOUT" || row.is_call_out === true;
}

function isExplicitOffRow(row: CurrentAvailabilityShiftInput): boolean {
  return normalizeStatus(row) === "OFF" || row.is_scheduled_today === false;
}

function isOvernightWrap(start: number, end: number): boolean {
  return end <= start;
}

/**
 * Same-day window: start inclusive, end exclusive.
 * Overnight wrap on this work_date: scheduled-now from start through midnight
 * (now >= start). Morning-before-start is Later today — not the wrap's end.
 */
function availabilityFromWindow(
  start: number,
  end: number,
  nowMinutes: number
): CurrentAvailability {
  if (isOvernightWrap(start, end)) {
    if (nowMinutes >= start) return onNow();
    return later();
  }
  if (nowMinutes < start) return later();
  if (nowMinutes >= end) return off("AFTER_SHIFT");
  return onNow();
}

function availabilityFromScheduledRow(
  row: CurrentAvailabilityShiftInput,
  nowMinutes: number
): CurrentAvailability {
  const start = parseClockMinutes(row.start_time ?? undefined);
  const end = parseClockMinutes(row.end_time ?? undefined);
  if (start == null || end == null) {
    return off("UNKNOWN", "Schedule unknown");
  }
  return availabilityFromWindow(start, end, nowMinutes);
}

/**
 * After midnight, yesterday's wrap (22:00→06:00) may still be in progress.
 * Requires the previous calendar day's persisted row. Missing previous ≠ on now.
 */
function overnightContinuation(
  previous: CurrentAvailabilityShiftInput | null | undefined,
  expectedPreviousDate: string,
  nowMinutes: number
): CurrentAvailability | null {
  if (!previous) return null;
  if (String(previous.work_date ?? "") !== expectedPreviousDate) return null;
  if (isCallOutRow(previous) || isExplicitOffRow(previous)) return null;
  const start = parseClockMinutes(previous.start_time ?? undefined);
  const end = parseClockMinutes(previous.end_time ?? undefined);
  if (start == null || end == null) return null;
  if (!isOvernightWrap(start, end)) return null;
  if (nowMinutes < end) return onNow();
  return null;
}

/**
 * Derive current expected availability from one persisted day row (+ optional
 * yesterday wrap) and store-local time. Missing/invalid evidence never becomes
 * scheduled-now. Does not invent a default shift length or clock window.
 */
export function composeCurrentAvailability(
  input: ComposeCurrentAvailabilityInput
): CurrentAvailability {
  const timeZone = resolveStoreTimezone(input.timeZone);
  const today = storeLocalWorkDate(input.now, timeZone);
  const nowMinutes = storeLocalMinutes(input.now, timeZone);
  const row = input.row;
  const rowDate = String(row?.work_date ?? "").trim();
  const rowIsToday = !rowDate || rowDate === today;
  const yesterday = previousStoreLocalWorkDate(input.now, timeZone);
  const continued = overnightContinuation(
    input.previousDay,
    yesterday,
    nowMinutes
  );

  if (row && rowIsToday && isCallOutRow(row)) {
    return off("CALLED_OUT", "Called out");
  }
  if (continued) return continued;
  if (!row) return off("UNKNOWN", "Schedule unknown");
  if (!rowIsToday) return off("UNKNOWN", "Schedule unknown");
  if (isExplicitOffRow(row)) return off("OFF_TODAY");
  return availabilityFromScheduledRow(row, nowMinutes);
}

export function isScheduledNow(
  availability: CurrentAvailability
): boolean {
  return availability.state === "SCHEDULED_NOW";
}

export function isLaterToday(availability: CurrentAvailability): boolean {
  return availability.state === "LATER_TODAY";
}
