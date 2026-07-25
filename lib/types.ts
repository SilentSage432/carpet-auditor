export type LocationType = "sales_floor" | "top_stock";

export type CarpetAudit = {
  id: string;
  sku: string;
  location: LocationType;
  whole_inches: number;
  fraction: number;
  measurement_inches: number;
  rounds: number;
  clf: number;
  created_at: string;
  offline?: boolean;
};

export type CarpetAuditInsert = Omit<CarpetAudit, "id" | "created_at" | "offline"> & {
  id?: string;
  created_at?: string;
};
