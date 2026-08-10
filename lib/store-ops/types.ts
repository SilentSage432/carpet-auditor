/**
 * Store Operations domain types — departments, mapped locations, weekly rotations.
 * Ownership: store-ops schema; presentation consumes, does not recompute cycle rules.
 */

export type StoreOpsUserRole = "super_admin" | "department_supervisor";

export type StoreLocationType = "SELLING" | "TOPSTOCK";

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
  aisle: number;
  bay: number;
  type: StoreLocationType;
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
  aisle: number;
  start_bay: number;
  end_bay: number;
  types: StoreLocationType[];
};

export function formatLocationLabel(
  loc: Pick<StoreLocation, "aisle" | "bay" | "type">
): string {
  return `Aisle ${loc.aisle} - Bay ${loc.bay} [${loc.type}]`;
}
