/**
 * ISO week helpers for weekly_rotations.assigned_week (e.g. "2026-W32").
 */

/** Safe draw size from departments.weekly_bay_target (null/0/invalid → 10). */
export function resolveWeeklyBayTarget(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 10;
  return Math.floor(n);
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
