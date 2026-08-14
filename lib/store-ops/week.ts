/**
 * ISO week helpers for weekly_rotations.assigned_week (e.g. "2026-W32").
 */

/** Safe draw size from departments.weekly_bay_target (null/0/invalid → 10). */
export function resolveWeeklyBayTarget(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 10;
  return Math.floor(n);
}

/** True when an ISO timestamp falls in the given ISO week label (e.g. 2026-W33). */
export function isoTimestampInWeek(
  iso: string | null | undefined,
  weekLabel: string
): boolean {
  if (!iso || !weekLabel) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return isoWeekLabel(new Date(t)) === weekLabel;
}

/** Return ISO week label for a Date (UTC-based ISO week-date). */
export function isoWeekLabel(date: Date = new Date()): string {
  const target = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  // Thursday in current week decides the year
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  const year = target.getUTCFullYear();
  return `${year}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Monday (UTC date string YYYY-MM-DD) for an ISO week label like "2026-W32".
 * Used by sunday_bay_assignments.week_starting.
 */
export function isoWeekToMondayDate(weekLabel: string): string {
  const m = /^(\d{4})-W(\d{1,2})$/i.exec(String(weekLabel ?? "").trim());
  if (!m) {
    throw new Error(`Invalid ISO week label: ${weekLabel}`);
  }
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - day + 1);
  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

/** Fisher–Yates shuffle (in place) then return first `count` items. */
export function pickRandom<T>(items: T[], count: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, Math.max(0, count));
}

type WeightedPickable = {
  manual_priority_count?: number | null;
  last_completed_at?: string | null;
};

/**
 * Adaptive draw: weight = (1 + manual_priority_count) × age_days
 * (null last_completed_at ≈ never audited → high age). Oldest + highest
 * manual frequency dominate selection without full determinism.
 */
export function pickWeightedByPriorityAndAge<T extends WeightedPickable>(
  items: T[],
  count: number
): T[] {
  const n = Math.max(0, Math.min(count, items.length));
  if (n === 0) return [];
  if (n >= items.length) return [...items];

  const pool = [...items];
  const picked: T[] = [];

  while (picked.length < n && pool.length > 0) {
    const weights = pool.map(adaptiveDrawWeight);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let r = Math.random() * (total > 0 ? total : pool.length);
    let idx = 0;
    for (; idx < pool.length; idx += 1) {
      r -= total > 0 ? weights[idx]! : 1;
      if (r <= 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    picked.push(pool[idx]!);
    pool.splice(idx, 1);
  }

  return picked;
}

export type WeeklyPaceTone = "ahead" | "on_track" | "behind";

export type WeeklyPaceForecast = {
  tone: WeeklyPaceTone;
  label: string;
  actual_pct: number;
  expected_pct: number;
  assigned: number;
  completed: number;
};

/** ISO weekday 1=Monday … 7=Sunday. */
export function isoWeekday(date = new Date()): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

/**
 * Linear week-to-date pace vs ISO weekday (Mon=1/7 … Sun=7/7).
 * ±10 pts of expected % → On Track; above Ahead; below Behind.
 */
export function forecastWeeklyPace(input: {
  assigned: number;
  completed: number;
  now?: Date;
}): WeeklyPaceForecast {
  const assigned = Math.max(0, Math.floor(input.assigned));
  const completed = Math.max(0, Math.min(assigned, Math.floor(input.completed)));
  const actual_pct = assigned <= 0 ? 0 : Math.round((completed / assigned) * 100);
  const expected_pct = Math.round((isoWeekday(input.now ?? new Date()) / 7) * 100);
  const delta = actual_pct - expected_pct;
  let tone: WeeklyPaceTone = "on_track";
  if (assigned <= 0) {
    tone = "on_track";
  } else if (delta >= 10) {
    tone = "ahead";
  } else if (delta <= -10) {
    tone = "behind";
  }
  const label =
    assigned <= 0
      ? "On Track · no bays assigned"
      : tone === "ahead"
        ? `Ahead · ${actual_pct}% vs ${expected_pct}% expected`
        : tone === "behind"
          ? `Behind · ${actual_pct}% vs ${expected_pct}% expected`
          : `On Track · ${actual_pct}% vs ${expected_pct}% expected`;
  return { tone, label, actual_pct, expected_pct, assigned, completed };
}

export function adaptiveDrawWeight(loc: WeightedPickable): number {
  const priority = 1 + Math.max(0, Number(loc.manual_priority_count) || 0);
  const last = loc.last_completed_at
    ? Date.parse(loc.last_completed_at)
    : Number.NaN;
  // Never audited → treat as ~1 year old so they surface early
  const ageMs = Number.isFinite(last)
    ? Math.max(0, Date.now() - last)
    : 365 * 86_400_000;
  const ageDays = Math.max(1, ageMs / 86_400_000);
  return priority * ageDays;
}
