/**
 * Neutral aisle-rotation location eligibility.
 * Shared by Layer-1 metrics and SI-001 — no week/rotation-engine imports.
 */

export type LocationEligibilityFields = {
  is_active?: boolean | null;
  location_type?: string | null;
};

/**
 * Eligible for weekly aisle rotation / cycle readiness denominator.
 * Matches draw filters: active + not SHOWROOM_STACKOUT.
 */
export function isEligibleRotationLocation(
  loc: LocationEligibilityFields | null | undefined
): boolean {
  if (!loc) return false;
  if (loc.is_active === false) return false;
  return (loc.location_type ?? "STANDARD") !== "SHOWROOM_STACKOUT";
}
