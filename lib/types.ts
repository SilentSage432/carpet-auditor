export type LocationType = "sales_floor" | "top_stock";

export type HubSection =
  | "audit"
  /** @deprecated Removed from bottom nav — redirects to appliances. */
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

/** Roster onboarding lifecycle on store_specialists.status */
export type AssociateOnboardingStatus = "invited" | "active" | "suspended";

/**
 * App authentication vs floor roster.
 * Roster-only members are status=active with no PIN — they schedule but cannot sign in.
 */
export type AppAccessStatus = "roster_only" | "invited" | "active";

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
  "cabinets",
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
  "cabinets",
  "tools",
  "building_materials",
];

/**
 * Lowe's specialty sales departments — floor title is Specialist.
 * Platform role stays Associate | Supervisor | MasterAdmin.
 */
export const SPECIALTY_DEPARTMENTS = [
  "flooring",
  "appliances",
  "millwork",
  "cabinets",
] as const;

export type SpecialtyDepartment = (typeof SPECIALTY_DEPARTMENTS)[number];

/**
 * Lowe's core departments — floor title is CSA (Customer Service Associate).
 * Includes Electrical (not listed as specialty) and legacy garden/hardware aliases.
 */
export const CORE_DEPARTMENTS = [
  "paint",
  "plumbing",
  "electrical",
  "lawn_garden",
  "inside_garden",
  "outside_garden",
  "building_materials",
  "hardware",
  "tools",
] as const;

export type CoreDepartment = (typeof CORE_DEPARTMENTS)[number];

export type AssociateFloorTitle = "Specialist" | "CSA";

export function isSpecialtyDepartment(
  dept: DepartmentScope | string | null | undefined
): dept is SpecialtyDepartment {
  return (SPECIALTY_DEPARTMENTS as readonly string[]).includes(String(dept ?? ""));
}

export function isCoreDepartment(
  dept: DepartmentScope | string | null | undefined
): dept is CoreDepartment {
  return (CORE_DEPARTMENTS as readonly string[]).includes(String(dept ?? ""));
}

/** Retail floor designation for an Associate in this department. */
export function associateFloorTitle(
  dept: DepartmentScope | string | null | undefined
): AssociateFloorTitle {
  return isSpecialtyDepartment(dept) ? "Specialist" : "CSA";
}

export type DepartmentMeta = {
  id: DepartmentScope;
  label: string;
  shortLabel: string;
  description: string;
};

export const DEPARTMENT_META: Record<DepartmentScope, DepartmentMeta> = {
  flooring: {
    id: "flooring",
    label: "Flooring / Home Decor",
    shortLabel: "Flooring",
    description: "Flooring & Home Decor (merged)",
  },
  appliances: {
    id: "appliances",
    label: "Appliances",
    shortLabel: "Appliances",
    description: "Appliances Inventory",
  },
  plumbing: {
    id: "plumbing",
    label: "Plumbing",
    shortLabel: "Plumbing",
    description: "Plumbing & Fixtures",
  },
  electrical: {
    id: "electrical",
    label: "Electrical",
    shortLabel: "Electrical",
    description: "Electrical & Lighting",
  },
  lawn_garden: {
    id: "lawn_garden",
    label: "Lawn & Garden",
    shortLabel: "Lawn/Garden",
    description: "Legacy — prefer Inside / Outside Garden",
  },
  inside_garden: {
    id: "inside_garden",
    label: "Inside Garden",
    shortLabel: "Inside Garden",
    description: "Inside Garden (D28I)",
  },
  outside_garden: {
    id: "outside_garden",
    label: "Outside Garden",
    shortLabel: "Outside Garden",
    description: "Outside Garden (D28O)",
  },
  paint: {
    id: "paint",
    label: "Paint",
    shortLabel: "Paint",
    description: "Paint (D24P)",
  },
  millwork: {
    id: "millwork",
    label: "Millwork",
    shortLabel: "Millwork",
    description: "Millwork (D30)",
  },
  cabinets: {
    id: "cabinets",
    label: "Cabinets",
    shortLabel: "Cabinets",
    description: "Cabinets (D29)",
  },
  building_materials: {
    id: "building_materials",
    label: "Building Materials",
    shortLabel: "Bldg Mat",
    description: "Lumber & Building Materials",
  },
  hardware: {
    id: "hardware",
    label: "Hardware",
    shortLabel: "Hardware",
    description: "Legacy — prefer Tools (D25)",
  },
  tools: {
    id: "tools",
    label: "Tools",
    shortLabel: "Tools",
    description: "Tools (D25)",
  },
  all: {
    id: "all",
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

/** Lowe's department numbers used in roster accordion headings. */
export const DEPARTMENT_LOWE_CODE: Record<DepartmentScope, string | null> = {
  flooring: "D23",
  appliances: "D35",
  plumbing: "D26",
  electrical: "D24",
  lawn_garden: "D28",
  inside_garden: "D28",
  outside_garden: "D28O",
  paint: "D24P",
  millwork: "D30",
  cabinets: "D29",
  building_materials: "D21",
  hardware: "D25",
  tools: "D25",
  all: null,
};

const DEPARTMENT_ALIASES: Record<string, DepartmentScope> = {
  d23: "flooring",
  carpet: "flooring",
  flooring: "flooring",
  d35: "appliances",
  appliance: "appliances",
  appliances: "appliances",
  d26: "plumbing",
  plumbing: "plumbing",
  d24: "electrical",
  d24e: "electrical",
  electrical: "electrical",
  lawn_and_garden: "lawn_garden",
  lawn: "lawn_garden",
  garden: "lawn_garden",
  outdoor: "lawn_garden",
  lawn_garden: "lawn_garden",
  d28: "inside_garden",
  d28i: "inside_garden",
  inside_garden: "inside_garden",
  insidegarden: "inside_garden",
  d28o: "outside_garden",
  outside_garden: "outside_garden",
  d24p: "paint",
  paint: "paint",
  d30: "millwork",
  millwork: "millwork",
  d29: "cabinets",
  cabinet: "cabinets",
  cabinets: "cabinets",
  bldg_materials: "building_materials",
  lumber: "building_materials",
  building: "building_materials",
  building_materials: "building_materials",
  d21: "building_materials",
  hardware: "hardware",
  d25: "tools",
  tools: "tools",
  "*": "all",
  all: "all",
  full_store: "all",
};

/** Map hub scopes, Lowe's codes (D23, D28I), and display names to DepartmentScope. */
export function parseDepartmentScope(raw: unknown): DepartmentScope | null {
  const value = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  if (!value) return null;
  return DEPARTMENT_ALIASES[value] ?? (isDepartmentScope(value) ? value : null);
}

/** Roster accordion title: `D23 · Flooring`. */
export function departmentRosterHeading(dept: DepartmentScope): string {
  if (dept === "all") return "Full Store";
  const code = DEPARTMENT_LOWE_CODE[dept];
  const label = DEPARTMENT_META[dept]?.shortLabel ?? dept;
  return code ? `${code} · ${label}` : label;
}

/** Home department for roster grouping — assigned_department is canonical. */
export function specialistHomeDepartment(member: {
  assigned_department?: DepartmentScope | null;
  role?: SpecialistRole;
}): DepartmentScope {
  const dept = member.assigned_department;
  if (dept && dept !== "all") return dept;
  return member.role === "MasterAdmin" ? "all" : "flooring";
}

export function departmentMeta(id: DepartmentScope | null | undefined): DepartmentMeta {
  if (id && isDepartmentScope(id)) return DEPARTMENT_META[id];
  return DEPARTMENT_META.flooring;
}

/** Short label: "Flooring Specialist" / "Paint CSA". */
export function associateFloorTitleLabel(
  dept: DepartmentScope | string | null | undefined
): string {
  const meta = departmentMeta(
    dept && isDepartmentScope(dept) ? dept : "flooring"
  );
  return `${meta.shortLabel} ${associateFloorTitle(dept)}`;
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

/** Home appliance inventory — top-level suites (Washer/Dryer collapsed into Laundry). */
export const APPLIANCE_CATEGORIES = [
  "Laundry",
  "Refrigeration",
  "Cooking / Ranges",
  "Dishwashers",
  "Microwaves / Venting",
] as const;

export type ApplianceCategory = (typeof APPLIANCE_CATEGORIES)[number];

/** Sub-categories required when linking / logging appliances. */
export const APPLIANCE_SUBCATEGORIES = {
  Laundry: ["Washer", "Dryer", "Combo / Unit"],
  Refrigeration: [
    "French Door",
    "Side-by-Side",
    "Top Freezer",
    "Bottom Freezer",
    "Chest / Upright Freezer",
    "Beverage / Compact",
  ],
  "Cooking / Ranges": ["Range / Stove", "Cooktop", "Wall Oven", "Range Hood"],
  Dishwashers: ["Built-In", "Portable"],
  "Microwaves / Venting": [
    "Over-the-Range",
    "Countertop",
    "Built-In",
    "Vent Hood",
  ],
} as const satisfies Record<ApplianceCategory, readonly string[]>;

export type ApplianceSubCategory =
  (typeof APPLIANCE_SUBCATEGORIES)[ApplianceCategory][number];

export function applianceSubsForCategory(
  category: ApplianceCategory | string
): readonly string[] {
  if ((APPLIANCE_CATEGORIES as readonly string[]).includes(category)) {
    return APPLIANCE_SUBCATEGORIES[category as ApplianceCategory];
  }
  return [];
}

export function isValidApplianceSubCategory(
  category: ApplianceCategory | string,
  sub: string | null | undefined
): boolean {
  const value = String(sub ?? "").trim();
  if (!value) return false;
  return applianceSubsForCategory(category).includes(value);
}

/** Unified catalog / audit category (flooring + appliances for legacy carpet_* rows). */
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

const LEGACY_APPLIANCE_MAP: Record<
  string,
  { category: ApplianceCategory; sub_category: string }
> = {
  refrigerator: { category: "Refrigeration", sub_category: "French Door" },
  freezer: {
    category: "Refrigeration",
    sub_category: "Chest / Upright Freezer",
  },
  refrigeration: { category: "Refrigeration", sub_category: "French Door" },
  washer: { category: "Laundry", sub_category: "Washer" },
  dryer: { category: "Laundry", sub_category: "Dryer" },
  laundry: { category: "Laundry", sub_category: "" },
  cooking: { category: "Cooking / Ranges", sub_category: "Range / Stove" },
  "cooking / ranges": {
    category: "Cooking / Ranges",
    sub_category: "Range / Stove",
  },
  "range / stove": {
    category: "Cooking / Ranges",
    sub_category: "Range / Stove",
  },
  range: { category: "Cooking / Ranges", sub_category: "Range / Stove" },
  "range hood": { category: "Cooking / Ranges", sub_category: "Range Hood" },
  dishwasher: { category: "Dishwashers", sub_category: "Built-In" },
  dishwashers: { category: "Dishwashers", sub_category: "Built-In" },
  microwave: { category: "Microwaves / Venting", sub_category: "Countertop" },
  microwaves: { category: "Microwaves / Venting", sub_category: "Countertop" },
  "microwaves / venting": {
    category: "Microwaves / Venting",
    sub_category: "Countertop",
  },
  "appliance accessories": {
    category: "Cooking / Ranges",
    sub_category: "Range / Stove",
  },
  "combo/unit": { category: "Laundry", sub_category: "Combo / Unit" },
  "drink/compact": {
    category: "Refrigeration",
    sub_category: "Beverage / Compact",
  },
  "chest/upright freezer": {
    category: "Refrigeration",
    sub_category: "Chest / Upright Freezer",
  },
};

const LEGACY_SUB_ALIASES: Record<string, string> = {
  "combo/unit": "Combo / Unit",
  "drink/compact": "Beverage / Compact",
  "chest/upright freezer": "Chest / Upright Freezer",
  "beverage / compact": "Beverage / Compact",
  "chest / upright freezer": "Chest / Upright Freezer",
  "combo / unit": "Combo / Unit",
};

function normalizeSubAlias(raw: string): string {
  const key = raw.trim().toLowerCase();
  return LEGACY_SUB_ALIASES[key] ?? raw.trim();
}

export function isApplianceCategory(
  category: string | null | undefined
): boolean {
  if (!category) return false;
  if ((APPLIANCE_CATEGORIES as readonly string[]).includes(category)) {
    return true;
  }
  const key = category.trim().toLowerCase();
  return key in LEGACY_APPLIANCE_MAP;
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

/**
 * Map legacy or current labels onto top-level category + optional sub.
 * Sub may be empty when only a top-level suite is known.
 */
export function resolveApplianceCategoryPair(
  rawCategory: unknown,
  rawSub?: unknown
): { category: ApplianceCategory; sub_category: string } {
  const categoryRaw = String(rawCategory ?? "").trim();
  const subRaw = normalizeSubAlias(String(rawSub ?? "").trim());

  if ((APPLIANCE_CATEGORIES as readonly string[]).includes(categoryRaw)) {
    const category = categoryRaw as ApplianceCategory;
    if (isValidApplianceSubCategory(category, subRaw)) {
      return { category, sub_category: subRaw };
    }
    return { category, sub_category: "" };
  }

  const legacyKey = categoryRaw.toLowerCase();
  if (legacyKey in LEGACY_APPLIANCE_MAP) {
    const mapped = LEGACY_APPLIANCE_MAP[legacyKey]!;
    if (isValidApplianceSubCategory(mapped.category, subRaw)) {
      return { category: mapped.category, sub_category: subRaw };
    }
    return {
      category: mapped.category,
      sub_category: mapped.sub_category
        ? normalizeSubAlias(mapped.sub_category)
        : "",
    };
  }

  if (/^range\s*\/?\s*stove$/i.test(categoryRaw)) {
    return { category: "Cooking / Ranges", sub_category: "Range / Stove" };
  }

  return { category: "Laundry", sub_category: "" };
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
  if (isApplianceCategory(value)) {
    return resolveApplianceCategoryPair(value).category;
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
  return resolveApplianceCategoryPair(raw).category;
}

export function normalizeApplianceSubCategory(
  category: ApplianceCategory | string,
  raw: unknown
): string {
  return resolveApplianceCategoryPair(category, raw).sub_category;
}

/** Canonical appliance master SKU / UPC link record (`public.appliance_catalog`). */
export type ApplianceCatalogItem = {
  id: string;
  store_number: string;
  item_number: string;
  upc: string | null;
  description: string;
  category: ApplianceCategory;
  sub_category?: string;
  created_at: string;
  updated_at: string;
  offline?: boolean;
};

export type ApplianceCatalogItemInsert = Omit<
  ApplianceCatalogItem,
  "id" | "created_at" | "updated_at" | "offline" | "store_number" | "sub_category"
> & {
  id?: string;
  store_number?: string;
  sub_category?: string;
};

/** Floor scan log (`public.appliance_scans`). */
export type ApplianceScan = {
  id: string;
  store_number: string;
  item_number: string;
  serial_number: string;
  location: string;
  category: ApplianceCategory;
  sub_category?: string;
  scanned_by: string;
  scanned_at: string;
  offline?: boolean;
};

export type ApplianceScanInsert = Omit<
  ApplianceScan,
  "id" | "scanned_at" | "offline" | "store_number" | "sub_category"
> & {
  id?: string;
  store_number?: string;
  scanned_at?: string;
  sub_category?: string;
};

export type StoreSpecialist = {
  id: string;
  store_number: string;
  name: string;
  role: SpecialistRole;
  /** Optional access PIN / password. Required for Supervisor & Master Admin. */
  pin_code: string | null;
  /** Salted SHA-256 PIN (server payloads). Roster lists omit this column. */
  pin_hash?: string | null;
  /** Login username (supervisors / master admin). */
  username: string | null;
  /** Department workspace this profile may access. */
  assigned_department: DepartmentScope | null;
  /**
   * Primary assigned_department plus granted cross-department scopes.
   * Master Admin is implied full-store (not stored as `all` in this array).
   */
  accessible_departments?: OperationalDepartment[];
  /** First-login must set custom username + password. */
  must_change_credentials: boolean;
  /** Invite onboarding: must set a permanent PIN before dashboard access. */
  must_change_pin?: boolean;
  /** SMS invite destination (E.164 when set). */
  phone_number?: string | null;
  /**
   * Roster onboarding: invited (awaiting /auth/verify PIN) · active · suspended.
   * Active includes roster-only members (no PIN / app access).
   * When omitted, derive from is_active + must_change_pin.
   */
  status?: AssociateOnboardingStatus;
  /** Set when a PIN is created or rotated — roster lists use this (not pin_hash) for app-access. */
  pin_updated_at?: string | null;
  /** Linked auth.users.id after invite/signup claim. Null for roster-only members. */
  auth_user_id?: string | null;
  /** Optional contact email used to claim an existing roster row on Auth signup. */
  email?: string | null;
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
  /** Appliance suite detail (e.g. Dryer); empty for flooring. */
  sub_category: string;
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
  "id" | "created_at" | "offline" | "store_number" | "sub_category"
> & {
  id?: string;
  created_at?: string;
  store_number?: string;
  sub_category?: string;
};

export type CatalogItem = {
  id: string;
  store_number: string;
  sku: string;
  carpet_name: string;
  vendor: string;
  category: CatalogCategory;
  /** Appliance suite detail (e.g. Dryer); empty for flooring. */
  sub_category: string;
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
  "id" | "created_at" | "updated_at" | "offline" | "store_number" | "sub_category"
> & {
  id?: string;
  store_number?: string;
  sub_category?: string;
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
    id: "appliances",
    label: "Appliances Audit",
    title: "Appliances Audit",
    icon: "🔌",
    description: "Unit counts + appliance SIMS staging audits",
  },
  {
    id: "remnants",
    label: "Remnants",
    title: "Remnant Rack",
    icon: "📦",
    description: "Back-room remnant inventory & status",
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
