/**
 * Store Operations domain types — departments, mapped locations, weekly rotations.
 * Ownership: store-ops schema; presentation consumes, does not recompute cycle rules.
 */

export type StoreOpsUserRole =
  | "super_admin"
  | "department_supervisor"
  | "associate";


export type StoreLocationType = "SELLING" | "TOPSTOCK";

/** Retail bay numbering: odd face or even face (step 2). */
export type BayNumberingPattern = "odd" | "even";

/** Zone kind — orthogonal to Selling/Topstock `type`. */
export type StoreLocationKind = "STANDARD" | "SHOWROOM_STACKOUT";

export type RotationStatus =
  | "PENDING"
  | "ASSIGNED"
  | "COMPLETED"
  | "CARRIED_OVER";

/** IRP walk-the-floor intensity on bay_service_logs. */
export type BayServiceIntensity =
  | "light_touch"
  | "heavy_packdown"
  | "critical_hole";

/** Down-stocking velocity on store_locations (auto-tier + Sunday draw). */
export type VelocityTier = "standard" | "high" | "critical_hotspot";

export type Department = {
  id: string;
  store_id: string;
  store_number?: string | null;
  name: string;
  code: string;
  weekly_bay_target: number;
  is_active: boolean;
  last_verified_week?: string | null;
  last_verified_at?: string | null;
  created_at?: string;
};

export type StoreLocation = {
  id: string;
  store_id: string;
  store_number?: string | null;
  department_id: string;
  /** Alphanumeric aisle code (BW, RW, 12, A1) — stored as TEXT. */
  aisle: string;
  bay: number;
  type: StoreLocationType;
  /** STANDARD aisle rotation vs SHOWROOM_STACKOUT rapid-touch zone. */
  location_type?: StoreLocationKind;
  audit_frequency_days?: number;
  manual_priority_count?: number;
  status: RotationStatus;
  last_completed_at: string | null;
  /** Denormalized departments.code (IRP logs / heatmap). */
  department_code?: string | null;
  /** Walk-the-floor last touch — distinct from last_completed_at. */
  last_serviced_at?: string | null;
  velocity_tier?: VelocityTier | null;
  priority_override?: boolean | null;
  /** Sunday-draw cadence override (3–21). Null uses velocity-tier default. */
  custom_decay_days?: number | null;
  /** Next Sunday draw prepend flag — cleared when assigned or completed. */
  carried_over?: boolean | null;
  /** When the bay last entered the call-out carry-over loop. */
  last_carried_over_at?: string | null;
  cycle_number: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type BayServiceLog = {
  id: string;
  store_id: string;
  location_id: string;
  department_code: string;
  serviced_by: string | null;
  intensity: BayServiceIntensity;
  notes: string | null;
  created_at: string;
};

/**
 * Week-item DS review — owned by weekly_rotations, not store_locations.status.
 * PENDING = staged · PENDING_VERIFICATION = associate submitted · VERIFIED_COMPLETE = DS closed.
 */
export type RotationVerificationStatus =
  | "PENDING"
  | "PENDING_VERIFICATION"
  | "VERIFIED_COMPLETE";

export type WeeklyRotation = {
  id: string;
  store_id: string;
  store_number?: string | null;
  department_id: string;
  location_id: string;
  assigned_week: string;
  week_number?: number | null;
  year?: number | null;
  is_completed: boolean;
  completed_at: string | null;
  verification_status?: RotationVerificationStatus | null;
  completed_by?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  review_note?: string | null;
  created_at?: string;
};

export function resolveVerificationStatus(
  row:
    | Pick<WeeklyRotation, "verification_status" | "is_completed">
    | null
    | undefined
): RotationVerificationStatus {
  const raw = String(row?.verification_status ?? "").toUpperCase();
  if (
    raw === "PENDING" ||
    raw === "PENDING_VERIFICATION" ||
    raw === "VERIFIED_COMPLETE"
  ) {
    return raw;
  }
  return row?.is_completed ? "VERIFIED_COMPLETE" : "PENDING";
}

export type WeeklyRotationWithLocation = WeeklyRotation & {
  store_locations: StoreLocation | null;
};

export type ExceptionReason =
  | "Blocked Bay"
  | "Unpalletized Top-Stock"
  | "Missing SIMS Tags"
  | "Freight/Pallets In Aisle"
  | "Short Staffed"
  | "High Customer Volume"
  | "Other";

export type RotationException = {
  id: string;
  department_id: string;
  bay_id: string;
  reason: string;
  cycle_number: number;
  assigned_week: string | null;
  reported_by: string | null;
  created_at: string;
};

export type BulkGenerateInput = {
  department_id: string;
  /** Alphanumeric aisle code (normalized uppercase on write). */
  aisle: string;
  start_bay: number;
  end_bay: number;
  types: StoreLocationType[];
  /**
   * Retail bay numbering: odd face 1,3,5… or even face 2,4,6….
   * Default odd. Step is 2 so facing sides do not duplicate.
   */
  bay_pattern?: BayNumberingPattern;
  /** Bulk seed: standard (14d) · high (5d) · priority_lock (always in Sunday draw). */
  velocity_seed?: "standard" | "high" | "priority_lock";
  velocity_tier?: VelocityTier;
  priority_override?: boolean;
  custom_decay_days?: number;
};

/** Compact bay tag for tabular mono display — `A14-B06`, `BW-B12`. */
export function formatBayTag(
  loc: Pick<StoreLocation, "aisle" | "bay">
): string {
  const aisleRaw = String(loc.aisle ?? "").trim().toUpperCase();
  const bayNum = Math.floor(Number(loc.bay));
  const bay = Number.isFinite(bayNum)
    ? String(bayNum).padStart(2, "0")
    : String(loc.bay ?? "").padStart(2, "0");
  const aisle = /^\d+$/.test(aisleRaw)
    ? `A${aisleRaw}`
    : aisleRaw || "A?";
  return `${aisle}-B${bay}`;
}

export function formatLocationLabel(
  loc: Pick<StoreLocation, "aisle" | "bay"> & {
    type?: string | null;
    location_type?: string | null;
  }
): string {
  const base = formatBayTag(loc);
  const parts = [loc.type, loc.location_type === "SHOWROOM_STACKOUT" ? "SHOWROOM" : null]
    .filter(Boolean)
    .join(" · ");
  return parts ? `${base} [${parts}]` : base;
}

/** Rotation PENDING = mapped, available for Sunday draw (not an approval gate). */
export function isPendingDrawLocation(
  loc: Pick<StoreLocation, "status"> | null | undefined
): boolean {
  return String(loc?.status ?? "").toUpperCase() === "PENDING";
}

const CARRY_OVER_BADGE_MS = 14 * 86_400_000;

/** Floor / Sunday amber badge — assignment or location carry-over window. */
export function isCarryOverPriorityBadge(
  loc?: Pick<
    StoreLocation,
    "carried_over" | "last_carried_over_at" | "status"
  > | null,
  assignment?: { status?: string | null; is_carried_over?: boolean | null } | null
): boolean {
  if (assignment?.is_carried_over === true) return true;
  if (String(assignment?.status ?? "").toUpperCase() === "CARRIED_OVER") {
    return true;
  }
  if (loc?.carried_over === true) return true;
  if (loc?.status === "CARRIED_OVER") return true;
  const at = loc?.last_carried_over_at;
  if (!at) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && Date.now() - t < CARRY_OVER_BADGE_MS;
}

/** True when a showroom/stack-out bay is due for a quick touch. */
export function isShowroomDue(
  loc: Pick<StoreLocation, "last_completed_at" | "audit_frequency_days" | "location_type">
): boolean {
  if (loc.location_type !== "SHOWROOM_STACKOUT") return false;
  const freq = Math.max(1, Number(loc.audit_frequency_days) || 7);
  if (!loc.last_completed_at) return true;
  const last = Date.parse(loc.last_completed_at);
  if (!Number.isFinite(last)) return true;
  const ageDays = (Date.now() - last) / 86_400_000;
  return ageDays >= freq;
}
