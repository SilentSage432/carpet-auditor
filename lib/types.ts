export type LocationType = "sales_floor" | "top_stock";

export type HubSection =
  | "audit"
  | "catalog"
  | "remnants"
  | "appliances"
  | "department"
  | "settings";

/**
 * Platform roles:
 * - MasterAdmin — unrestricted cross-department access
 * - Supervisor — department-scoped (assigned_department)
 * - Associate — shift PIN access within a department
 */
export type SpecialistRole = "Associate" | "Supervisor" | "MasterAdmin";

/** Standard Lowe's store departments + master full-store scope. */
export const STORE_DEPARTMENTS = [
  "flooring",
  "appliances",
  "plumbing",
  "electrical",
  "lawn_garden",
  "inside_garden",
  "outside_garden",
  "paint",
  "millwork",
  "building_materials",
  "hardware",
  "tools",
  "all",
] as const;

export type DepartmentScope = (typeof STORE_DEPARTMENTS)[number];

/** Operational departments (excludes master `all`). */
export type OperationalDepartment = Exclude<DepartmentScope, "all">;

export const OPERATIONAL_DEPARTMENTS: OperationalDepartment[] = [
  "flooring",
  "appliances",
  "plumbing",
  "electrical",
  "paint",
  "inside_garden",
  "outside_garden",
  "millwork",
  "tools",
  "building_materials",
];

export type DepartmentMeta = {
  id: DepartmentScope;
  icon: string;
  label: string;
  shortLabel: string;
  description: string;
};

export const DEPARTMENT_META: Record<DepartmentScope, DepartmentMeta> = {
  flooring: {
    id: "flooring",
    icon: "🧶",
    label: "Flooring / Home Decor",
    shortLabel: "Flooring",
    description: "Flooring & Home Decor (merged)",
  },
  appliances: {
    id: "appliances",
    icon: "🔌",
    label: "Appliances",
    shortLabel: "Appliances",
    description: "Appliances Inventory",
  },
  plumbing: {
    id: "plumbing",
    icon: "🚿",
    label: "Plumbing",
    shortLabel: "Plumbing",
    description: "Plumbing & Fixtures",
  },
  electrical: {
    id: "electrical",
    icon: "💡",
    label: "Electrical",
    shortLabel: "Electrical",
    description: "Electrical & Lighting",
  },
  lawn_garden: {
    id: "lawn_garden",
    icon: "🌿",
    label: "Lawn & Garden",
    shortLabel: "Lawn/Garden",
    description: "Legacy — prefer Inside / Outside Garden",
  },
  inside_garden: {
    id: "inside_garden",
    icon: "🪴",
    label: "Inside Garden",
    shortLabel: "Inside Garden",
    description: "Inside Garden (D28I)",
  },
  outside_garden: {
    id: "outside_garden",
    icon: "🌿",
    label: "Outside Garden",
    shortLabel: "Outside Garden",
    description: "Outside Garden (D28O)",
  },
  paint: {
    id: "paint",
    icon: "🎨",
    label: "Paint",
    shortLabel: "Paint",
    description: "Paint (D24P)",
  },
  millwork: {
    id: "millwork",
    icon: "🚪",
    label: "Millwork",
    shortLabel: "Millwork",
    description: "Millwork (D30)",
  },
  building_materials: {
    id: "building_materials",
    icon: "🪵",
    label: "Building Materials",
    shortLabel: "Bldg Mat",
    description: "Lumber & Building Materials",
  },
  hardware: {
    id: "hardware",
    icon: "🔧",
    label: "Hardware",
    shortLabel: "Hardware",
    description: "Legacy — prefer Tools (D25)",
  },
  tools: {
    id: "tools",
    icon: "🛠️",
    label: "Tools",
    shortLabel: "Tools",
    description: "Tools (D25)",
  },
  all: {
    id: "all",
    icon: "👑",
    label: "Full Store",
    shortLabel: "All Depts",
    description: "Master Admin — Full Store Access",
  },
};

export function isDepartmentScope(raw: unknown): raw is DepartmentScope {
  return (
    typeof raw === "string" &&
    (STORE_DEPARTMENTS as readonly string[]).includes(raw)
  );
}

export function departmentMeta(id: DepartmentScope | null | undefined): DepartmentMeta {
  if (id && isDepartmentScope(id)) return DEPARTMENT_META[id];
  return DEPARTMENT_META.flooring;
}

/** Flooring / SIMS catalog categories. */
export const FLOORING_CATEGORIES = [
  "Carpet",
  "Sheet Vinyl",
  "Vinyl Plank",
  "Tile & Stone",
  "Hardwood",
  "Grout & Mortar",
  "Accessories",
] as const;

export type FlooringCategory = (typeof FLOORING_CATEGORIES)[number];

/** Home appliance inventory categories. */
export const APPLIANCE_CATEGORIES = [
  "Refrigerator",
  "Washer",
  "Dryer",
  "Range / Stove",
  "Dishwasher",
  "Microwave",
  "Range Hood",
  "Freezer",
  "Appliance Accessories",
] as const;

export type ApplianceCategory = (typeof APPLIANCE_CATEGORIES)[number];

/** Unified catalog / audit category (flooring + appliances). */
export type CatalogCategory = FlooringCategory | ApplianceCategory;

export const CATALOG_CATEGORIES = [
  ...FLOORING_CATEGORIES,
  ...APPLIANCE_CATEGORIES,
] as const;

/** Quick SIMS staging chips for appliance floor audits. */
export const APPLIANCE_SIMS_SUGGESTIONS = [
  "Appliance Wall Bay 01",
  "Top Stock Bay 012",
  "Receiving Holding",
  "Clearance Floor",
] as const;

export type AuditMode = "roll" | "carton";

/** Standard roll widths for Carpet & Sheet Vinyl. */
export const ROLL_WIDTH_OPTIONS_FT = [12, 15] as const;

/** Default roll width when none is selected / legacy values are remapped. */
export const DEFAULT_ROLL_WIDTH_FT = 12;

/** Normalize legacy (e.g. 6 ft) or null widths onto the 12 / 15 ft preset set. */
export function normalizeRollWidthFt(
  ft: number | null | undefined
): (typeof ROLL_WIDTH_OPTIONS_FT)[number] {
  if (ft === 15) return 15;
  return DEFAULT_ROLL_WIDTH_FT;
}

export function isApplianceCategory(
  category: string | null | undefined
): boolean {
  return (
    !!category &&
    (APPLIANCE_CATEGORIES as readonly string[]).includes(category)
  );
}

/** Carpet & Sheet Vinyl (resilient roll) use CLF measurement; everything else uses unit/carton counts. */
export function isRollGoodsCategory(category: CatalogCategory | string): boolean {
  return category === "Carpet" || category === "Sheet Vinyl";
}

export function auditModeForCategory(
  category: CatalogCategory | string | null | undefined
): AuditMode {
  return isRollGoodsCategory(category ?? "Carpet") ? "roll" : "carton";
}

export function normalizeCategory(raw: unknown): CatalogCategory {
  const value = String(raw ?? "Carpet").trim();
  // Accept longer display aliases from older notes / imports
  if (
    /^sheet\s*vinyl/i.test(value) ||
    /resilient\s*roll/i.test(value)
  ) {
    return "Sheet Vinyl";
  }
  if (/^range\s*\/?\s*stove$/i.test(value) || /^range$/i.test(value)) {
    return "Range / Stove";
  }
  if ((APPLIANCE_CATEGORIES as readonly string[]).includes(value)) {
    return value as ApplianceCategory;
  }
  if ((FLOORING_CATEGORIES as readonly string[]).includes(value)) {
    return value as FlooringCategory;
  }
  return "Carpet";
}

/** Prefer an appliance category when normalizing for the Appliances workspace. */
export function normalizeApplianceCategory(
  raw: unknown
): ApplianceCategory {
  const normalized = normalizeCategory(raw);
  if (isApplianceCategory(normalized)) {
    return normalized as ApplianceCategory;
  }
  return "Refrigerator";
}

export type StoreSpecialist = {
  id: string;
  store_number: string;
  name: string;
  role: SpecialistRole;
  /** Optional access PIN / password. Required for Supervisor & Master Admin. */
  pin_code: string | null;
  /** Login username (supervisors / master admin). */
  username: string | null;
  /** Department workspace this profile may access. */
  assigned_department: DepartmentScope | null;
  /** First-login must set custom username + password. */
  must_change_credentials: boolean;
  /** Soft-delete flag — false means deactivated / removed from active roster. */
  is_active: boolean;
  created_at: string;
  offline?: boolean;
};

/** Alias: flooring_audits — physical cycle counts (rolls + cartons + appliance units). */
export type CarpetAudit = {
  id: string;
  store_number: string;
  sku: string;
  carpet_name: string;
  category: CatalogCategory;
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
  category: CatalogCategory;
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
  category: CatalogCategory;
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
    label: "Flooring Audit",
    title: "Flooring Audit",
    icon: "📊",
    description: "Roll CLF + carton / SIMS location audits",
  },
  {
    id: "catalog",
    label: "Universal Catalog",
    title: "Universal Catalog",
    icon: "🏷️",
    description: "Master SKUs, barcodes & location tags",
  },
  {
    id: "remnants",
    label: "Remnants",
    title: "Remnant Rack",
    icon: "📦",
    description: "Back-room remnant inventory & status",
  },
  {
    id: "appliances",
    label: "Appliances Audit",
    title: "Appliances Audit",
    icon: "🔌",
    description: "Unit counts + appliance SIMS staging audits",
  },
  {
    id: "department",
    label: "Department Audit",
    title: "Department Audit",
    icon: "🏬",
    description: "Unit-count SIMS audits for non-flooring departments",
  },
  {
    id: "settings",
    label: "Master Settings",
    title: "Master Settings",
    icon: "⚙️",
    description: "Store context, Supabase & offline queue",
  },
];
