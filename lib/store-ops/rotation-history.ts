/**
 * Weekly rotation active vs historical contract.
 * Active = superseded_at IS NULL. Superseded rows preserve stage evidence (Art V).
 * Does not own Force Draw selection math or Layer-1 formulas.
 */

export const ROTATION_SUPERSEDE_SOURCES = [
  "FORCE_DRAW",
  "ADMIN_RESET",
  "CONFLICT_CLEAR",
] as const;

export type RotationSupersedeSource =
  (typeof ROTATION_SUPERSEDE_SOURCES)[number];

export type RotationActiveRow = {
  superseded_at?: string | null;
};

/** Operational plan rows only — Layer-1 and Floor/Map current week. */
export function isActiveWeeklyRotation(
  row: RotationActiveRow | null | undefined
): boolean {
  if (!row) return false;
  const raw = row.superseded_at;
  return raw == null || String(raw).trim() === "";
}

export function filterActiveWeeklyRotations<T extends RotationActiveRow>(
  rows: T[] | null | undefined
): T[] {
  return (rows ?? []).filter((row) => isActiveWeeklyRotation(row));
}

/** PostgREST filter: active operational week rows. */
export function applyActiveWeeklyRotationFilter<
  T extends { is: (column: string, value: null) => T },
>(query: T): T {
  return query.is("superseded_at", null);
}
