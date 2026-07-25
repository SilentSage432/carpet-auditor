export type LocationType = "sales_floor" | "top_stock";

export type CarpetAudit = {
  id: string;
  sku: string;
  carpet_name: string;
  location_type: LocationType;
  /** Whole-inch portion of the measurement. */
  measurement_inches: number;
  /** Fraction pad value (0–0.875). */
  measurement_fraction: number;
  rounds: number;
  calculated_clf: number;
  created_at: string;
  offline?: boolean;
};

export type CarpetAuditInsert = Omit<CarpetAudit, "id" | "created_at" | "offline"> & {
  id?: string;
  created_at?: string;
};

/** Total inches used in CLF = whole + fraction. */
export function totalInches(audit: Pick<CarpetAudit, "measurement_inches" | "measurement_fraction">): number {
  return audit.measurement_inches + audit.measurement_fraction;
}
