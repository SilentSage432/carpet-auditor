/**
 * Store Audit Velocity Telemetry — owns hourly pace math for the active shift.
 * Composes completion + exception timestamps; does not fetch Supabase or recommend actions.
 * Shift window: 06:00 → 22:00 (linear target to 100% by shift end).
 */

export const SHIFT_START_HOUR = 6;
export const SHIFT_END_HOUR = 22;

export type TelemetryCompletionEvent = {
  completed_at: string | null;
  department_id: string;
  department_code?: string;
  department_name?: string;
  is_completed?: boolean;
};

export type TelemetryExceptionEvent = {
  created_at: string;
  department_id: string;
  department_code?: string;
};

export type TelemetryHourPoint = {
  hour: number;
  label: string;
  completions: number;
  cumulative: number;
  velocity_pct: number;
  target_pct: number;
  exception_count: number;
  is_exception_spike: boolean;
};

export type TelemetrySeries = {
  key: string;
  label: string;
  department_code: string | null;
  daily_target: number;
  assigned: number;
  completed_today: number;
  points: TelemetryHourPoint[];
  /** Actual − target at the latest elapsed hour (positive = ahead). */
  ahead_behind_pct: number;
  current_velocity_pct: number;
  current_target_pct: number;
};

export type StoreAuditTelemetry = {
  shift_date: string;
  shift_start_hour: number;
  shift_end_hour: number;
  as_of: string;
  timezone_note: string;
  series: TelemetrySeries[];
};

export type TelemetrySeriesSpec = {
  key: string;
  label: string;
  /** Match department codes/names (case-insensitive). Empty = overall store. */
  matchCodes?: string[];
  matchNames?: string[];
};

/** Default Zebra chart toggles — Overall + Flooring + Appliances. */
export const DEFAULT_TELEMETRY_SERIES_SPECS: TelemetrySeriesSpec[] = [
  { key: "overall", label: "Overall Store" },
  {
    key: "flooring",
    label: "D23 Flooring",
    matchCodes: ["flooring", "d23", "0023"],
    matchNames: ["flooring", "home decor"],
  },
  {
    key: "appliances",
    label: "D35 Appliances",
    matchCodes: ["appliances", "d35", "0035"],
    matchNames: ["appliance"],
  },
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function hourLabel(hour: number): string {
  return `${pad2(hour)}:00`;
}

/** Local calendar YYYY-MM-DD for a Date. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0
  );
}

/** Inclusive shift bounds for a calendar day in local time. */
export function shiftWindowForDate(date: Date): { start: Date; end: Date } {
  const day = startOfLocalDay(date);
  const start = new Date(day);
  start.setHours(SHIFT_START_HOUR, 0, 0, 0);
  const end = new Date(day);
  end.setHours(SHIFT_END_HOUR, 0, 0, 0);
  return { start, end };
}

/**
 * Linear target % for a clock hour within the shift.
 * 06:00 → 0%, 22:00 → 100%.
 */
export function targetPctAtHour(hour: number): number {
  const span = SHIFT_END_HOUR - SHIFT_START_HOUR;
  if (span <= 0) return 0;
  const clamped = Math.min(SHIFT_END_HOUR, Math.max(SHIFT_START_HOUR, hour));
  return Math.round(((clamped - SHIFT_START_HOUR) / span) * 1000) / 10;
}

function parseTs(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return new Date(t);
}

function hourBucket(date: Date): number {
  return date.getHours();
}

function matchesSpec(
  spec: TelemetrySeriesSpec,
  code: string,
  name: string
): boolean {
  if (!spec.matchCodes?.length && !spec.matchNames?.length) return true;
  const c = code.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  if (spec.matchCodes?.some((m) => c === m.toLowerCase() || c.includes(m.toLowerCase()))) {
    return true;
  }
  if (spec.matchNames?.some((m) => n.includes(m.toLowerCase()))) {
    return true;
  }
  return false;
}

function velocityPct(cumulative: number, dailyTarget: number): number {
  if (dailyTarget <= 0) return 0;
  return Math.min(
    100,
    Math.round((cumulative / dailyTarget) * 1000) / 10
  );
}

function markExceptionSpikes(
  points: TelemetryHourPoint[]
): TelemetryHourPoint[] {
  const counts = points.map((p) => p.exception_count);
  const withEx = counts.filter((c) => c > 0);
  if (withEx.length === 0) {
    return points.map((p) => ({ ...p, is_exception_spike: false }));
  }
  const avg =
    withEx.reduce((s, c) => s + c, 0) / Math.max(1, withEx.length);
  const threshold = Math.max(1, avg);
  return points.map((p) => ({
    ...p,
    is_exception_spike: p.exception_count >= threshold && p.exception_count > 0,
  }));
}

export type BuildTelemetryInput = {
  now?: Date;
  completions: TelemetryCompletionEvent[];
  exceptions: TelemetryExceptionEvent[];
  /** Department roster for targets + code/name resolution. */
  departments: Array<{
    department_id: string;
    department_code: string;
    department_name: string;
    weekly_bay_target: number;
    assigned: number;
  }>;
  seriesSpecs?: TelemetrySeriesSpec[];
};

/**
 * Aggregate active-shift hourly completion velocity + linear target baseline.
 */
export function buildStoreAuditTelemetry(
  input: BuildTelemetryInput
): StoreAuditTelemetry {
  const now = input.now ?? new Date();
  const { start, end } = shiftWindowForDate(now);
  const specs = input.seriesSpecs ?? DEFAULT_TELEMETRY_SERIES_SPECS;

  const series = specs.map((spec) => {
    const depts = input.departments.filter((d) =>
      matchesSpec(spec, d.department_code, d.department_name)
    );
    const scopedDepts =
      !spec.matchCodes?.length && !spec.matchNames?.length
        ? input.departments
        : depts;
    const idSet = new Set(scopedDepts.map((d) => d.department_id));
    const daily_target = Math.max(
      1,
      scopedDepts.reduce(
        (s, d) => s + Math.max(1, Math.floor(d.weekly_bay_target) || 1),
        0
      )
    );
    const assigned = scopedDepts.reduce((s, d) => s + d.assigned, 0);

    const hourCompletions = new Map<number, number>();
    const hourExceptions = new Map<number, number>();
    for (let h = SHIFT_START_HOUR; h <= SHIFT_END_HOUR; h++) {
      hourCompletions.set(h, 0);
      hourExceptions.set(h, 0);
    }

    let completed_today = 0;
    for (const event of input.completions) {
      if (idSet.size > 0 && !idSet.has(event.department_id)) continue;
      if (event.is_completed === false) continue;
      const ts = parseTs(event.completed_at);
      if (!ts) continue;
      if (ts < start || ts > end) continue;
      const h = hourBucket(ts);
      if (h < SHIFT_START_HOUR || h > SHIFT_END_HOUR) continue;
      hourCompletions.set(h, (hourCompletions.get(h) ?? 0) + 1);
      completed_today += 1;
    }

    // Graceful fallback: completed rows missing timestamps → distribute across elapsed hours
    const missingTs = input.completions.filter((event) => {
      if (idSet.size > 0 && !idSet.has(event.department_id)) return false;
      if (event.is_completed !== true) return false;
      return !parseTs(event.completed_at);
    });
    if (missingTs.length > 0 && completed_today === 0) {
      const nowHour = Math.min(
        SHIFT_END_HOUR,
        Math.max(SHIFT_START_HOUR, now.getHours())
      );
      const elapsedHours = Math.max(1, nowHour - SHIFT_START_HOUR + 1);
      missingTs.forEach((event, idx) => {
        if (idSet.size > 0 && !idSet.has(event.department_id)) return;
        const h =
          SHIFT_START_HOUR + (idx % elapsedHours);
        hourCompletions.set(h, (hourCompletions.get(h) ?? 0) + 1);
        completed_today += 1;
      });
    }

    for (const ex of input.exceptions) {
      if (idSet.size > 0 && !idSet.has(ex.department_id)) continue;
      const ts = parseTs(ex.created_at);
      if (!ts) continue;
      if (ts < start || ts > end) continue;
      const h = hourBucket(ts);
      if (h < SHIFT_START_HOUR || h > SHIFT_END_HOUR) continue;
      hourExceptions.set(h, (hourExceptions.get(h) ?? 0) + 1);
    }

    let cumulative = 0;
    const rawPoints: TelemetryHourPoint[] = [];
    for (let h = SHIFT_START_HOUR; h <= SHIFT_END_HOUR; h++) {
      const completions = hourCompletions.get(h) ?? 0;
      cumulative += completions;
      rawPoints.push({
        hour: h,
        label: hourLabel(h),
        completions,
        cumulative,
        velocity_pct: velocityPct(cumulative, daily_target),
        target_pct: targetPctAtHour(h),
        exception_count: hourExceptions.get(h) ?? 0,
        is_exception_spike: false,
      });
    }
    const points = markExceptionSpikes(rawPoints);

    const cursorHour = Math.min(
      SHIFT_END_HOUR,
      Math.max(SHIFT_START_HOUR, now.getHours())
    );
    const cursor =
      points.find((p) => p.hour === cursorHour) ?? points[points.length - 1];
    const current_velocity_pct = cursor?.velocity_pct ?? 0;
    const current_target_pct = cursor?.target_pct ?? 0;

    return {
      key: spec.key,
      label: spec.label,
      department_code:
        scopedDepts.length === 1 ? scopedDepts[0].department_code : null,
      daily_target,
      assigned,
      completed_today,
      points,
      ahead_behind_pct:
        Math.round((current_velocity_pct - current_target_pct) * 10) / 10,
      current_velocity_pct,
      current_target_pct,
    } satisfies TelemetrySeries;
  });

  return {
    shift_date: localDateKey(now),
    shift_start_hour: SHIFT_START_HOUR,
    shift_end_hour: SHIFT_END_HOUR,
    as_of: now.toISOString(),
    timezone_note: "local store clock",
    series,
  };
}

/** Compact payload for Gemini / briefing prompts. */
export function compactTelemetryForPrompt(
  telemetry: StoreAuditTelemetry | null | undefined
): Record<string, unknown> | null {
  if (!telemetry) return null;
  return {
    shift_date: telemetry.shift_date,
    shift_window: `${hourLabel(telemetry.shift_start_hour)}–${hourLabel(telemetry.shift_end_hour)}`,
    as_of: telemetry.as_of,
    series: telemetry.series.map((s) => ({
      key: s.key,
      label: s.label,
      daily_target: s.daily_target,
      completed_today: s.completed_today,
      current_velocity_pct: s.current_velocity_pct,
      current_target_pct: s.current_target_pct,
      ahead_behind_pct: s.ahead_behind_pct,
      exception_hours: s.points
        .filter((p) => p.is_exception_spike)
        .map((p) => ({
          hour: p.label,
          exceptions: p.exception_count,
        })),
      hourly_velocity: s.points
        .filter((_, i) => i % 2 === 0 || i === s.points.length - 1)
        .map((p) => ({
          hour: p.label,
          velocity_pct: p.velocity_pct,
          target_pct: p.target_pct,
          completions: p.completions,
        })),
    })),
  };
}

export function findTelemetrySeries(
  telemetry: StoreAuditTelemetry | null | undefined,
  key: string
): TelemetrySeries | null {
  if (!telemetry) return null;
  return telemetry.series.find((s) => s.key === key) ?? telemetry.series[0] ?? null;
}
