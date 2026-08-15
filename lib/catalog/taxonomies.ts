/**
 * Department-specific catalog taxonomies — owns default category trees + overrides.
 * Catalog SKU persistence stays in lib/catalog.ts; this only composes folder taxonomies.
 * Does not recommend assortment — registry is structural browse metadata only.
 */

import {
  APPLIANCE_CATEGORIES,
  APPLIANCE_SUBCATEGORIES,
  FLOORING_CATEGORIES,
  type OperationalDepartment,
} from "@/lib/types";

export type TaxonomyCategory = {
  name: string;
  slug: string;
  subcategories: string[];
};

export type DepartmentTaxonomy = {
  department_code: string;
  department_name: string;
  categories: TaxonomyCategory[];
};

/** Canonical Lowe's-style catalog department codes for taxonomy browse. */
export const CATALOG_TAXONOMY_CODES = [
  "D21",
  "D22",
  "D23",
  "D24",
  "D25",
  "D26",
  "D27",
  "D28",
  "D29",
  "D35",
  "D52",
] as const;

export type CatalogTaxonomyCode = (typeof CATALOG_TAXONOMY_CODES)[number];

export const TAXONOMY_CODE_META: Record<
  CatalogTaxonomyCode,
  { name: string; hubDepartments: OperationalDepartment[] }
> = {
  D21: { name: "Lumber", hubDepartments: ["building_materials"] },
  D22: { name: "Building Materials", hubDepartments: ["building_materials"] },
  D23: { name: "Flooring", hubDepartments: ["flooring"] },
  D24: { name: "Paint", hubDepartments: ["paint"] },
  D25: { name: "Millwork", hubDepartments: ["millwork"] },
  D26: { name: "Plumbing", hubDepartments: ["plumbing"] },
  D27: { name: "Electrical", hubDepartments: ["electrical"] },
  D28: {
    name: "Lawn & Garden",
    hubDepartments: ["lawn_garden", "inside_garden", "outside_garden"],
  },
  D29: { name: "Cabinets", hubDepartments: ["cabinets"] },
  D35: { name: "Appliances", hubDepartments: ["appliances"] },
  D52: { name: "Tools", hubDepartments: ["tools", "hardware"] },
};

const OVERRIDE_STORAGE_KEY = "deptsync_catalog_taxonomies";

export function slugifyCategoryName(name: string): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/**
 * Normalize department codes from UI / AI / Lowe's padded forms.
 * Accepts D25, d25, 25, 0025 → D25; D24P stays D24P.
 */
export function normalizeTaxonomyCode(raw: string | null | undefined): string {
  const trimmed = String(raw ?? "").trim().toUpperCase();
  if (!trimmed) return "";
  const match = trimmed.match(/^D?0*(\d+)([A-Z]?)$/i);
  if (match) {
    const num = String(Number(match[1]));
    const suffix = (match[2] || "").toUpperCase();
    if (Number.isFinite(Number(num)) && Number(num) > 0) {
      return `D${num.padStart(2, "0")}${suffix}`;
    }
  }
  return trimmed;
}

export function isCatalogTaxonomyCode(code: string): code is CatalogTaxonomyCode {
  return (CATALOG_TAXONOMY_CODES as readonly string[]).includes(code);
}

/** Primary taxonomy code for a hub operational department. */
export function taxonomyCodeForHubDepartment(
  department: OperationalDepartment | string
): CatalogTaxonomyCode | null {
  const key = String(department ?? "").trim();
  const map: Record<string, CatalogTaxonomyCode> = {
    building_materials: "D22",
    lumber: "D21",
    flooring: "D23",
    paint: "D24",
    millwork: "D25",
    cabinets: "D29",
    plumbing: "D26",
    electrical: "D27",
    lawn_garden: "D28",
    inside_garden: "D28",
    outside_garden: "D28",
    appliances: "D35",
    tools: "D52",
    hardware: "D52",
  };
  return map[key] ?? null;
}

function cat(name: string, subcategories: string[]): TaxonomyCategory {
  return {
    name,
    slug: slugifyCategoryName(name),
    subcategories: [...subcategories],
  };
}

function flooringDefaults(): TaxonomyCategory[] {
  return FLOORING_CATEGORIES.map((name) => {
    if (name === "Carpet") {
      return cat(name, ["Residential Carpet", "Berber", "Frieze", "Carpet Tile"]);
    }
    if (name === "Sheet Vinyl") {
      return cat(name, ["12ft Sheet", "15ft Sheet", "Commercial Sheet"]);
    }
    if (name === "Vinyl Plank") {
      return cat(name, ["LVP", "LVT", "Rigid Core", "Glue-Down"]);
    }
    if (name === "Tile & Stone") {
      return cat(name, ["Ceramic", "Porcelain", "Natural Stone", "Mosaic"]);
    }
    if (name === "Hardwood") {
      return cat(name, ["Solid Hardwood", "Engineered Hardwood", "Bamboo"]);
    }
    if (name === "Grout & Mortar") {
      return cat(name, ["Grout", "Thinset", "Mastic", "Underlayment"]);
    }
    return cat(name, ["Transitions", "Pad", "Adhesive", "Cleaners"]);
  });
}

function applianceDefaults(): TaxonomyCategory[] {
  return APPLIANCE_CATEGORIES.map((name) =>
    cat(name, [...APPLIANCE_SUBCATEGORIES[name]])
  );
}

/** Built-in default trees keyed by catalog taxonomy code. */
export const DEFAULT_DEPARTMENT_TAXONOMIES: Record<
  CatalogTaxonomyCode,
  DepartmentTaxonomy
> = {
  D21: {
    department_code: "D21",
    department_name: "Lumber",
    categories: [
      cat("Dimensional Lumber", ["2x4", "2x6", "2x8", "2x10", "2x12", "Studs"]),
      cat("Plywood & OSB", ["CDX Plywood", "OSB", "Sandply", "Pressure-Treated Panels"]),
      cat("Pressure-Treated", ["PT Boards", "PT Posts", "Ground Contact", "Above Ground"]),
      cat("Boards & Trim", ["1x Boards", "Furring", "Lattice", "Cedar Boards"]),
    ],
  },
  D22: {
    department_code: "D22",
    department_name: "Building Materials",
    categories: [
      cat("Drywall", ["Sheets", "Corner Bead", "Joint Compound", "Tape"]),
      cat("Insulation", ["Batt", "Roll", "Foam Board", "Spray Foam"]),
      cat("Roofing", ["Shingles", "Underlayment", "Ridge Cap", "Flashing"]),
      cat("Concrete & Masonry", ["Bag Concrete", "Mortar Mix", "Blocks", "Rebar"]),
      cat("House Wrap & Barriers", ["House Wrap", "Vapor Barrier", "Flashing Tape"]),
    ],
  },
  D23: {
    department_code: "D23",
    department_name: "Flooring",
    categories: flooringDefaults(),
  },
  D24: {
    department_code: "D24",
    department_name: "Paint",
    categories: [
      cat("Interior Paint", ["Flat", "Eggshell", "Satin", "Semi-Gloss", "Primer"]),
      cat("Exterior Paint", ["Flat", "Satin", "Gloss", "Stain", "Primer"]),
      cat("Stains & Finishes", ["Deck Stain", "Wood Stain", "Polyurethane", "Oil Finish"]),
      cat("Painting Tools", ["Rollers", "Brushes", "Tape", "Trays", "Sprayers"]),
      cat("Wallpaper & Wall Coverings", ["Wallpaper", "Paste", "Removers"]),
    ],
  },
  D25: {
    department_code: "D25",
    department_name: "Millwork",
    categories: [
      cat("Doors", [
        "Interior Doors",
        "Exterior Doors",
        "Patio Doors",
        "Screen & Storm Doors",
      ]),
      cat("Moulding & Millwork", [
        "Baseboard",
        "Crown Moulding",
        "Casing",
        "PVC Moulding",
      ]),
      cat("Windows", ["Vinyl Windows", "Wood Windows", "Skylights", "Window Screens"]),
      cat("Stair Parts", ["Balusters", "Newels", "Handrails", "Treads"]),
    ],
  },
  D26: {
    department_code: "D26",
    department_name: "Plumbing",
    categories: [
      cat("Faucets", ["Kitchen", "Bathroom", "Utility", "Touchless"]),
      cat("Sinks & Tubs", ["Kitchen Sinks", "Bathroom Sinks", "Tubs", "Showers"]),
      cat("Toilets", ["One-Piece", "Two-Piece", "Smart Toilets", "Seats"]),
      cat("Pipe & Fittings", ["PEX", "PVC", "Copper", "SharkBite"]),
      cat("Water Heaters", ["Tank", "Tankless", "Expansion Tanks", "Parts"]),
    ],
  },
  D27: {
    department_code: "D27",
    department_name: "Electrical",
    categories: [
      cat("Wire & Cable", ["NM-B", "THHN", "Low Voltage", "Extension Cords"]),
      cat("Breakers & Panels", ["Breakers", "Load Centers", "GFCI/AFCI", "Disconnects"]),
      cat("Outlets & Switches", ["Outlets", "Switches", "Dimmer", "USB Outlets"]),
      cat("Lighting", ["Ceiling", "Vanity", "Recessed", "Outdoor", "Smart Lighting"]),
      cat("Conduit & Boxes", ["PVC Conduit", "Metal Conduit", "Junction Boxes", "Covers"]),
    ],
  },
  D28: {
    department_code: "D28",
    department_name: "Lawn & Garden",
    categories: [
      cat("Live Goods", ["Annuals", "Perennials", "Shrubs", "Trees"]),
      cat("Lawn Care", ["Fertilizer", "Seed", "Weed Control", "Soil"]),
      cat("Outdoor Power", ["Mowers", "Trimmers", "Blowers", "Pressure Washers"]),
      cat("Patio & Grills", ["Grills", "Patio Furniture", "Fire Pits", "Umbrellas"]),
      cat("Irrigation", ["Hose", "Sprinklers", "Timers", "Drip"]),
    ],
  },
  D29: {
    department_code: "D29",
    department_name: "Cabinets",
    categories: [
      cat("Kitchen Cabinets", ["Stock", "Semi-Custom", "Base", "Wall", "Tall"]),
      cat("Bath Cabinets", ["Vanities", "Linen", "Medicine Cabinets"]),
      cat("Cabinet Hardware", ["Knobs", "Pulls", "Hinges", "Slides"]),
      cat("Countertops", ["Laminate", "Butcher Block", "Quartz", "Granite"]),
      cat("Accessories", ["Organizers", "Lazy Susans", "Trash Pull-Outs", "Lighting"]),
    ],
  },
  D35: {
    department_code: "D35",
    department_name: "Appliances",
    categories: applianceDefaults(),
  },
  D52: {
    department_code: "D52",
    department_name: "Tools",
    categories: [
      cat("Power Tools", ["Drills", "Saws", "Sanders", "Impact Drivers", "Batteries"]),
      cat("Hand Tools", ["Hammers", "Screwdrivers", "Pliers", "Wrenches", "Levels"]),
      cat("Tool Storage", ["Boxes", "Chests", "Bags", "Belts"]),
      cat("Measuring & Layout", ["Tape Measures", "Squares", "Lasers", "Chalk"]),
      cat("Safety Gear", ["Gloves", "Eye Protection", "Hearing", "Respirators"]),
    ],
  },
};

export function listDefaultTaxonomies(): DepartmentTaxonomy[] {
  return CATALOG_TAXONOMY_CODES.map((code) =>
    structuredClone(DEFAULT_DEPARTMENT_TAXONOMIES[code])
  );
}

export function getDefaultTaxonomy(
  departmentCode: string,
  departmentName?: string
): DepartmentTaxonomy {
  const code = normalizeTaxonomyCode(departmentCode);
  if (isCatalogTaxonomyCode(code)) {
    const base = structuredClone(DEFAULT_DEPARTMENT_TAXONOMIES[code]);
    if (departmentName?.trim()) {
      base.department_name = departmentName.trim();
    }
    return base;
  }
  const name =
    departmentName?.trim() ||
    TAXONOMY_CODE_META[code as CatalogTaxonomyCode]?.name ||
    "Department";
  return {
    department_code: code || departmentCode || "UNKNOWN",
    department_name: name,
    categories: [
      cat("General", ["Uncategorized", "Seasonal", "Clearance"]),
      cat("Accessories", ["Parts", "Consumables", "Hardware"]),
    ],
  };
}

export function normalizeTaxonomyCategory(raw: unknown): TaxonomyCategory | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const name = String(row.name ?? row.title ?? "").trim();
  if (!name) return null;
  const slugRaw = String(row.slug ?? "").trim();
  const slug = slugRaw ? slugifyCategoryName(slugRaw) : slugifyCategoryName(name);
  const subRaw = Array.isArray(row.subcategories)
    ? row.subcategories
    : Array.isArray(row.sub_categories)
      ? row.sub_categories
      : [];
  const subcategories = [
    ...new Set(
      subRaw
        .map((s) => String(s ?? "").trim())
        .filter(Boolean)
    ),
  ];
  return { name, slug, subcategories };
}

export function normalizeDepartmentTaxonomy(
  raw: unknown,
  fallbackCode?: string,
  fallbackName?: string
): DepartmentTaxonomy {
  const root =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const code = normalizeTaxonomyCode(
    String(root.department_code ?? root.code ?? fallbackCode ?? "")
  );
  const name = String(
    root.department_name ?? root.name ?? fallbackName ?? ""
  ).trim();
  const list = Array.isArray(root.categories) ? root.categories : [];
  const categories: TaxonomyCategory[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const catRow = normalizeTaxonomyCategory(item);
    if (!catRow) continue;
    if (seen.has(catRow.slug)) {
      const existing = categories.find((c) => c.slug === catRow.slug);
      if (existing) {
        existing.subcategories = [
          ...new Set([...existing.subcategories, ...catRow.subcategories]),
        ];
      }
      continue;
    }
    seen.add(catRow.slug);
    categories.push(catRow);
  }

  if (categories.length === 0) {
    return getDefaultTaxonomy(code || fallbackCode || "", name || fallbackName);
  }

  return {
    department_code: code || normalizeTaxonomyCode(fallbackCode) || "UNKNOWN",
    department_name:
      name ||
      fallbackName?.trim() ||
      TAXONOMY_CODE_META[code as CatalogTaxonomyCode]?.name ||
      "Department",
    categories,
  };
}

/** Merge AI / override categories into a base tree (expand, never drop existing). */
export function mergeTaxonomies(
  base: DepartmentTaxonomy,
  incoming: DepartmentTaxonomy
): DepartmentTaxonomy {
  const bySlug = new Map<string, TaxonomyCategory>();
  for (const c of base.categories) {
    bySlug.set(c.slug, {
      name: c.name,
      slug: c.slug,
      subcategories: [...c.subcategories],
    });
  }
  for (const c of incoming.categories) {
    const existing = bySlug.get(c.slug);
    if (!existing) {
      bySlug.set(c.slug, {
        name: c.name,
        slug: c.slug,
        subcategories: [...c.subcategories],
      });
      continue;
    }
    existing.subcategories = [
      ...new Set([...existing.subcategories, ...c.subcategories]),
    ];
    if (c.name.trim()) existing.name = c.name.trim();
  }
  return {
    department_code: incoming.department_code || base.department_code,
    department_name: incoming.department_name || base.department_name,
    categories: [...bySlug.values()],
  };
}

function readOverrideMap(): Record<string, DepartmentTaxonomy> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(OVERRIDE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, DepartmentTaxonomy> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      const code = normalizeTaxonomyCode(key);
      if (!code) continue;
      out[code] = normalizeDepartmentTaxonomy(value, code);
    }
    return out;
  } catch {
    return {};
  }
}

function writeOverrideMap(map: Record<string, DepartmentTaxonomy>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(map));
  window.dispatchEvent(
    new CustomEvent("deptsync:taxonomies-changed", { detail: { map } })
  );
}

export function getTaxonomyOverride(
  departmentCode: string
): DepartmentTaxonomy | null {
  const code = normalizeTaxonomyCode(departmentCode);
  if (!code) return null;
  return readOverrideMap()[code] ?? null;
}

export function saveTaxonomyOverride(taxonomy: DepartmentTaxonomy): void {
  const normalized = normalizeDepartmentTaxonomy(taxonomy);
  const code = normalizeTaxonomyCode(normalized.department_code);
  if (!code) return;
  const map = readOverrideMap();
  map[code] = { ...normalized, department_code: code };
  writeOverrideMap(map);
}

export function clearTaxonomyOverride(departmentCode: string): void {
  const code = normalizeTaxonomyCode(departmentCode);
  if (!code) return;
  const map = readOverrideMap();
  delete map[code];
  writeOverrideMap(map);
}

/**
 * Effective taxonomy: default registry merged with optional local AI override.
 * Server callers get defaults only (no localStorage).
 */
export function getTaxonomyForDepartment(
  departmentCode: string,
  departmentName?: string,
  options?: { includeOverrides?: boolean }
): DepartmentTaxonomy {
  const base = getDefaultTaxonomy(departmentCode, departmentName);
  const include =
    options?.includeOverrides !== false && typeof window !== "undefined";
  if (!include) return base;
  const override = getTaxonomyOverride(base.department_code);
  if (!override) return base;
  return mergeTaxonomies(base, override);
}

export function getTaxonomyForHubDepartment(
  department: OperationalDepartment | string,
  options?: { includeOverrides?: boolean }
): DepartmentTaxonomy | null {
  const code = taxonomyCodeForHubDepartment(department);
  if (!code) return null;
  const name = TAXONOMY_CODE_META[code].name;
  return getTaxonomyForDepartment(code, name, options);
}
