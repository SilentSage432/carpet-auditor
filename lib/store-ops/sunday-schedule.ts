/**
 * Sunday auto-stage schedule — store-owned timing knowledge.
 * Presentation and cron consume this; they do not recompute day/time rules.
 */

export const DEFAULT_SUNDAY_AUTO_STAGE_TIME = "05:00";
export const DEFAULT_STORE_TIMEZONE = "America/Denver";
export const DEFAULT_SUNDAY_AUTO_GENERATE = true;

export const STORE_TIMEZONE_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

export type StoreTimezone = (typeof STORE_TIMEZONE_OPTIONS)[number];

export type SundayScheduleSettings = {
  sunday_auto_generate: boolean;
  sunday_auto_stage_time: string;
  timezone: string;
};

export type SundayAutoRunDecision =
  | { run: true; weekLabel: string; localTime: string; timezone: string }
  | {
      run: false;
      weekLabel: string;
      reason: string;
      localTime: string;
      timezone: string;
    };

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Normalize "5:00", "05:00:00", "05:00 AM" → "HH:MM" (24h). Default 05:00. */
export function normalizeSundayStageTime(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return DEFAULT_SUNDAY_AUTO_STAGE_TIME;

  const ampm = /\s*(AM|PM)\s*$/i.exec(text);
  const core = text.replace(/\s*(AM|PM)\s*$/i, "").trim();
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(core);
  if (!m) return DEFAULT_SUNDAY_AUTO_STAGE_TIME;

  let hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return DEFAULT_SUNDAY_AUTO_STAGE_TIME;
  }
  if (minute < 0 || minute > 59) return DEFAULT_SUNDAY_AUTO_STAGE_TIME;

  if (ampm) {
    const isPm = ampm[1]!.toUpperCase() === "PM";
    if (hour === 12) hour = isPm ? 12 : 0;
    else if (isPm) hour += 12;
  }

  if (hour < 0 || hour > 23) return DEFAULT_SUNDAY_AUTO_STAGE_TIME;
  return `${pad2(hour)}:${pad2(minute)}`;
}

export function sundayStageMinutes(raw: unknown): number {
  const hhmm = normalizeSundayStageTime(raw);
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 5) * 60 + (m ?? 0);
}

export function formatSundayStageTimeDisplay(raw: unknown): string {
  const hhmm = normalizeSundayStageTime(raw);
  const [hRaw, m] = hhmm.split(":").map(Number);
  const hour24 = hRaw ?? 5;
  const minute = m ?? 0;
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${pad2(hour12)}:${pad2(minute)} ${ampm}`;
}

export function normalizeStoreTimezone(raw: unknown): string {
  const tz = String(raw ?? "").trim();
  if (!tz) return DEFAULT_STORE_TIMEZONE;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return DEFAULT_STORE_TIMEZONE;
  }
}

export function normalizeSundaySchedule(
  row: Partial<SundayScheduleSettings> | null | undefined
): SundayScheduleSettings {
  return {
    sunday_auto_generate: row?.sunday_auto_generate !== false,
    sunday_auto_stage_time: normalizeSundayStageTime(
      row?.sunday_auto_stage_time
    ),
    timezone: normalizeStoreTimezone(row?.timezone),
  };
}

function readPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

export function zonedParts(now: Date, timeZone: string): ZonedParts {
  const tz = normalizeStoreTimezone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  let hour = Number(readPart(parts, "hour"));
  if (hour === 24) hour = 0;

  return {
    year: Number(readPart(parts, "year")),
    month: Number(readPart(parts, "month")),
    day: Number(readPart(parts, "day")),
    weekday: WEEKDAY_INDEX[readPart(parts, "weekday")] ?? 0,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number(readPart(parts, "minute")) || 0,
  };
}

function addCalendarDays(
  parts: Pick<ZonedParts, "year" | "month" | "day">,
  days: number
): { year: number; month: number; day: number } {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day + days);
  const d = new Date(utc);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/**
 * ISO week from a timezone-agnostic Y-M-D (does not use host local getters).
 */
export function isoWeekLabelFromYmd(
  year: number,
  month: number,
  day: number
): string {
  const target = new Date(Date.UTC(year, month - 1, day));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Week the Sunday runner (and Sunday Force Draw) writes.
 * Sunday local → upcoming Monday's ISO week so staging happens before the week begins.
 * Mon–Sat local → that day's ISO week.
 */
export function sundayStagingWeekLabel(
  now: Date = new Date(),
  timeZone: string = DEFAULT_STORE_TIMEZONE
): string {
  const parts = zonedParts(now, timeZone);
  if (parts.weekday === 0) {
    const monday = addCalendarDays(parts, 1);
    return isoWeekLabelFromYmd(monday.year, monday.month, monday.day);
  }
  return isoWeekLabelFromYmd(parts.year, parts.month, parts.day);
}

export function formatZonedClock(parts: ZonedParts): string {
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function isSundayInTimeZone(
  now: Date,
  timeZone: string = DEFAULT_STORE_TIMEZONE
): boolean {
  return zonedParts(now, timeZone).weekday === 0;
}

/**
 * Whether the scheduled runner should generate for this store right now.
 * Does not inspect existing rotations — callers skip-if-exists separately.
 */
export function evaluateSundayAutoRun(
  settings: Partial<SundayScheduleSettings> | null | undefined,
  now: Date = new Date()
): SundayAutoRunDecision {
  const schedule = normalizeSundaySchedule(settings);
  const parts = zonedParts(now, schedule.timezone);
  const localTime = formatZonedClock(parts);
  const weekLabel = sundayStagingWeekLabel(now, schedule.timezone);
  const base = {
    weekLabel,
    localTime,
    timezone: schedule.timezone,
  };

  if (!schedule.sunday_auto_generate) {
    return {
      run: false,
      reason: "Auto-generate on schedule is disabled",
      ...base,
    };
  }

  if (parts.weekday !== 0) {
    return {
      run: false,
      reason: `Not Sunday in ${schedule.timezone} (local ${localTime})`,
      ...base,
    };
  }

  const nowMinutes = parts.hour * 60 + parts.minute;
  const stageMinutes = sundayStageMinutes(schedule.sunday_auto_stage_time);
  if (nowMinutes < stageMinutes) {
    return {
      run: false,
      reason: `Before auto-stage time (${formatSundayStageTimeDisplay(
        schedule.sunday_auto_stage_time
      )} ${schedule.timezone})`,
      ...base,
    };
  }

  return { run: true, ...base };
}
