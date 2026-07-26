export type LocationType = "sales_floor" | "top_stock";

export type HubSection = "audit" | "catalog" | "remnants" | "settings";

export type StoreSpecialist = {
  id: string;
  name: string;
  role: string;
  created_at: string;
  offline?: boolean;
};

export type CarpetAudit = {
  id: string;
  sku: string;
  carpet_name: string;
  location_type: LocationType;
  measurement_inches: number;
  measurement_fraction: number;
  rounds: number;
  calculated_clf: number;
  /** Optional system/on-hand CLF from Lowe's inventory. */
  system_clf: number | null;
  /** Physical CLF − System CLF when system_clf is set. */
  variance_clf: number | null;
  audited_by: string;
  created_at: string;
  offline?: boolean;
};

export type CarpetAuditInsert = Omit<CarpetAudit, "id" | "created_at" | "offline"> & {
  id?: string;
  created_at?: string;
};

export type CatalogItem = {
  id: string;
  sku: string;
  carpet_name: string;
  vendor: string;
  roll_width_ft: number;
  /** Vendor / handheld UPC linked to this Lowe's Item #. */
  upc_barcode: string | null;
  created_at: string;
  updated_at: string;
  offline?: boolean;
};

export type CatalogItemInsert = Omit<
  CatalogItem,
  "id" | "created_at" | "updated_at" | "offline"
> & {
  id?: string;
};

export type RemnantStatus = "available" | "reserved" | "sold";

export type Remnant = {
  id: string;
  sku: string;
  carpet_name: string;
  tag_number: string;
  width_ft: number;
  length_ft: number;
  square_feet: number;
  square_yards: number;
  location: string;
  notes: string;
  status: RemnantStatus;
  reserved_for: string;
  logged_by: string;
  created_at: string;
  updated_at: string;
  offline?: boolean;
};

export type RemnantInsert = Omit<
  Remnant,
  "id" | "created_at" | "updated_at" | "offline" | "square_feet" | "square_yards"
> & {
  id?: string;
  square_feet?: number;
  square_yards?: number;
};

export function totalInches(
  audit: Pick<CarpetAudit, "measurement_inches" | "measurement_fraction">
): number {
  return audit.measurement_inches + audit.measurement_fraction;
}

export const HUB_SECTIONS: {
  id: HubSection;
  label: string;
  title: string;
  icon: string;
  description: string;
}[] = [
  {
    id: "audit",
    label: "Cycle Audit",
    title: "Cycle Audit",
    icon: "📊",
    description: "Carpet roll auditor with CLF formula",
  },
  {
    id: "catalog",
    label: "Carpet Catalog",
    title: "Carpet Catalog",
    icon: "🏷️",
    description: "Master wall SKUs and name lookup",
  },
  {
    id: "remnants",
    label: "Remnant Rack",
    title: "Remnant Rack",
    icon: "📦",
    description: "Back-room remnant inventory & status",
  },
  {
    id: "settings",
    label: "Settings & Sync",
    title: "Settings & Sync",
    icon: "⚙️",
    description: "Supabase connection & local storage",
  },
];
