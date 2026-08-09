/**
 * ISO week helpers for weekly_rotations.assigned_week (e.g. "2026-W32").
 */

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
