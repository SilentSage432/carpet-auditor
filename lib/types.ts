export type LocationType = "sales_floor" | "top_stock";

export type HubSection = "audit" | "catalog" | "remnants" | "settings";

export type SpecialistRole = "Associate" | "Supervisor";

/** Flooring / SIMS catalog categories. */
export const FLOORING_CATEGORIES = [
  "Carpet",
  "Vinyl Plank",
  "Tile & Stone",
  "Hardwood",
  "Grout & Mortar",
  "Accessories",
] as const;

export type FlooringCategory = (typeof FLOORING_CATEGORIES)[number];

export type AuditMode = "roll" | "carton";

/** Carpet & vinyl roll goods use CLF measurement; everything else uses unit/carton counts. */
export function isRollGoodsCategory(category: FlooringCategory | string): boolean {
  return category === "Carpet";
}

export function auditModeForCategory(
  category: FlooringCategory | string | null | undefined
): AuditMode {
  return isRollGoodsCategory(category ?? "Carpet") ? "roll" : "carton";
}

export function normalizeCategory(raw: unknown): FlooringCategory {
  const value = String(raw ?? "Carpet");
  return (FLOORING_CATEGORIES as readonly string[]).includes(value)
    ? (value as FlooringCategory)
    : "Carpet";
}

export type StoreSpecialist = {
  id: string;
  store_number: string;
  name: string;
  role: SpecialistRole;
  /** Optional access PIN. Required for Supervisor profiles. */
  pin_code: string | null;
  created_at: string;
  offline?: boolean;
};

/** Alias: flooring_audits — physical cycle counts (rolls + cartons). */
export type CarpetAudit = {
  id: string;
  store_number: string;
  sku: string;
  carpet_name: string;
  category: FlooringCategory;
  /** SIMS bay / aisle tag, e.g. "Aisle 14 - Bay 012". */
  sims_location: string;
  location_type: LocationType;
  measurement_inches: number;
  measurement_fraction: number;
  rounds: number;
  calculated_clf: number;
  /** Carton / bag / unit count for non-roll goods. */
  box_count: number | null;
  /** Total coverage: cartons × sqft_per_box (or linear ft when applicable). */
  calculated_sqft: number | null;
  /** Optional system/on-hand CLF from Lowe's inventory. */
  system_clf: number | null;
  /** Physical CLF − System CLF when system_clf is set. */
  variance_clf: number | null;
  audited_by: string;
  created_at: string;
  offline?: boolean;
};

/** Contextual alias for multi-category flooring audits. */
export type FlooringAudit = CarpetAudit;

export type CarpetAuditInsert = Omit<
  CarpetAudit,
  "id" | "created_at" | "offline" | "store_number"
> & {
  id?: string;
  created_at?: string;
  store_number?: string;
};

export type CatalogItem = {
  id: string;
  store_number: string;
  sku: string;
  carpet_name: string;
  vendor: string;
  category: FlooringCategory;
  /** Default SIMS location tag for this SKU. */
  default_sims_location: string;
  roll_width_ft: number;
  /** Sq ft (or linear ft) coverage per carton / bag. */
  sqft_per_box: number | null;
  /** Vendor / handheld UPC linked to this Lowe's Item #. */
  upc_barcode: string | null;
  created_at: string;
  updated_at: string;
  offline?: boolean;
};

export type CatalogItemInsert = Omit<
  CatalogItem,
  "id" | "created_at" | "updated_at" | "offline" | "store_number"
> & {
  id?: string;
  store_number?: string;
};

export type RemnantStatus = "available" | "reserved" | "sold";

export type Remnant = {
  id: string;
  store_number: string;
  sku: string;
  carpet_name: string;
  category: FlooringCategory;
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
  /** Original estimated retail / list value before markdown. */
  estimated_value: number | null;
  markdown_percent: number | null;
  markdown_price: number | null;
  markdown_notes: string;
  markdown_by: string;
  markdown_at: string | null;
  created_at: string;
  updated_at: string;
  offline?: boolean;
};

export type RemnantInsert = Omit<
  Remnant,
  "id" | "created_at" | "updated_at" | "offline" | "square_feet" | "square_yards" | "store_number"
> & {
  id?: string;
  store_number?: string;
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
    title: "Flooring Cycle Audit",
    icon: "📊",
    description: "Roll CLF + carton / SIMS location audits",
  },
  {
    id: "catalog",
    label: "SIMS Catalog",
    title: "SIMS Catalog",
    icon: "🏷️",
    description: "Master SKUs, barcodes & location tags",
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
    description: "Store context, Supabase & offline queue",
  },
];
