/**
 * Store Operations domain types — departments, mapped locations, weekly rotations.
 * Ownership: store-ops schema; presentation consumes, does not recompute cycle rules.
 */

export type StoreOpsUserRole =
  | "super_admin"
  | "department_supervisor"
  | "associate";


export type StoreLocationType = "SELLING" | "TOPSTOCK";

/** Zone kind — orthogonal to Selling/Topstock `type`. */
export type StoreLocationKind = "STANDARD" | "SHOWROOM_STACKOUT";

export type RotationStatus =
  | "PENDING"
  | "ASSIGNED"
  | "COMPLETED"
  | "CARRIED_OVER";

export type Department = {
  id: string;
  store_id: string;
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
  cycle_number: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type WeeklyRotation = {
  id: string;
  store_id: string;
  department_id: string;
  location_id: string;
  assigned_week: string;
  is_completed: boolean;
  completed_at: string | null;
  created_at?: string;
};

export type WeeklyRotationWithLocation = WeeklyRotation & {
  store_locations: StoreLocation | null;
};

export type ExceptionReason =
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
};

export function formatLocationLabel(
  loc: Pick<StoreLocation, "aisle" | "bay"> & {
    type?: string | null;
    location_type?: string | null;
  }
): string {
  const base = `Aisle ${loc.aisle} - Bay ${loc.bay}`;
  const parts = [loc.type, loc.location_type === "SHOWROOM_STACKOUT" ? "SHOWROOM" : null]
    .filter(Boolean)
    .join(" · ");
  return parts ? `${base} [${parts}]` : base;
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
