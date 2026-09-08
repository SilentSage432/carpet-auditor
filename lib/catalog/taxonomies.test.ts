/**
 * AI-REDUCE-002 — Deterministic Catalog Taxonomy.
 *
 * Contract: department folder trees come from the shipped registry. No generative
 * path may exist, department identity may not be redefined by stored data, and
 * legacy on-device overrides stay readable and clearable rather than being destroyed.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CATALOG_TAXONOMY_CODES,
  clearTaxonomyOverride,
  DEFAULT_DEPARTMENT_TAXONOMIES,
  getDefaultTaxonomy,
  getTaxonomyForDepartment,
  getTaxonomyForHubDepartment,
  getTaxonomyOverride,
  normalizeTaxonomyCode,
  TAXONOMY_CODE_META,
} from "./taxonomies";

const root = path.resolve(__dirname, "..", "..");
const OVERRIDE_KEY = "deptsync_catalog_taxonomies";

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("catalog taxonomy registry", () => {
  it("resolves a deterministic tree for every supported department code", () => {
    for (const code of CATALOG_TAXONOMY_CODES) {
      const taxonomy = getDefaultTaxonomy(code);
      expect(taxonomy.department_code).toBe(code);
      expect(taxonomy.department_name).toBe(TAXONOMY_CODE_META[code].name);
      expect(taxonomy.categories.length).toBeGreaterThan(0);
      for (const category of taxonomy.categories) {
        expect(category.name.trim()).not.toBe("");
        expect(category.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(category.subcategories.length).toBeGreaterThan(0);
      }
    }
  });

  it("is stable across repeated reads for identical input", () => {
    for (const code of CATALOG_TAXONOMY_CODES) {
      expect(getDefaultTaxonomy(code)).toEqual(getDefaultTaxonomy(code));
    }
  });

  it("hands back a clone so callers cannot mutate the shipped registry", () => {
    const first = getDefaultTaxonomy("D23");
    first.categories[0].subcategories.push("MUTATED");
    expect(getDefaultTaxonomy("D23").categories[0].subcategories).not.toContain(
      "MUTATED"
    );
    expect(
      DEFAULT_DEPARTMENT_TAXONOMIES.D23.categories[0].subcategories
    ).not.toContain("MUTATED");
  });

  it("normalizes padded / lowercase department codes to registry identity", () => {
    expect(normalizeTaxonomyCode("d25")).toBe("D25");
    expect(normalizeTaxonomyCode("0025")).toBe("D25");
    expect(normalizeTaxonomyCode("25")).toBe("D25");
    expect(getDefaultTaxonomy("0035").department_code).toBe("D35");
  });

  it("fails safe for an unsupported department instead of throwing", () => {
    const taxonomy = getDefaultTaxonomy("D99");
    expect(taxonomy.department_code).toBe("D99");
    expect(taxonomy.categories.length).toBeGreaterThan(0);
    expect(getTaxonomyForHubDepartment("not_a_department")).toBeNull();
  });

  it("maps hub departments onto their registry taxonomy", () => {
    expect(getTaxonomyForHubDepartment("flooring")?.department_code).toBe("D23");
    expect(getTaxonomyForHubDepartment("appliances")?.department_code).toBe("D35");
    expect(getTaxonomyForHubDepartment("inside_garden")?.department_code).toBe(
      "D28"
    );
  });
});

describe("legacy on-device overrides", () => {
  beforeEach(() => {
    window.localStorage.removeItem(OVERRIDE_KEY);
  });
  afterEach(() => {
    window.localStorage.removeItem(OVERRIDE_KEY);
  });

  function seedOverride(value: unknown) {
    window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(value));
  }

  it("preserves previously stored folders rather than destroying them", () => {
    seedOverride({
      D25: {
        department_code: "D25",
        department_name: "Millwork",
        categories: [
          { name: "Shop Built", slug: "shop-built", subcategories: ["Jambs"] },
        ],
      },
    });

    const effective = getTaxonomyForDepartment("D25", "Millwork");
    const slugs = effective.categories.map((c) => c.slug);
    expect(slugs).toContain("shop-built");
    // Registry folders are expanded onto, never dropped.
    for (const category of DEFAULT_DEPARTMENT_TAXONOMIES.D25.categories) {
      expect(slugs).toContain(category.slug);
    }
  });

  it("can clear stored folders back to the registry tree", () => {
    seedOverride({
      D25: {
        department_code: "D25",
        department_name: "Millwork",
        categories: [
          { name: "Shop Built", slug: "shop-built", subcategories: ["Jambs"] },
        ],
      },
    });
    expect(getTaxonomyOverride("D25")).not.toBeNull();

    clearTaxonomyOverride("D25");

    expect(getTaxonomyOverride("D25")).toBeNull();
    expect(getTaxonomyForDepartment("D25", "Millwork")).toEqual(
      getDefaultTaxonomy("D25", "Millwork")
    );
  });

  it("never lets stored data redefine which department is being read", () => {
    seedOverride({
      D25: {
        department_code: "D35",
        department_name: "Appliances",
        categories: [
          { name: "Hijack", slug: "hijack", subcategories: ["Nope"] },
        ],
      },
    });

    const effective = getTaxonomyForDepartment("D25", "Millwork");
    expect(effective.department_code).toBe("D25");
    expect(effective.department_name).toBe("Millwork");
    // The requested department's registry folders are still the base tree.
    const slugs = effective.categories.map((c) => c.slug);
    for (const category of DEFAULT_DEPARTMENT_TAXONOMIES.D25.categories) {
      expect(slugs).toContain(category.slug);
    }
  });

  it("ignores corrupt stored data and falls back to the registry", () => {
    window.localStorage.setItem(OVERRIDE_KEY, "{not json");
    expect(getTaxonomyForDepartment("D25", "Millwork")).toEqual(
      getDefaultTaxonomy("D25", "Millwork")
    );
  });

  it("excludes stored folders from server-side reads", () => {
    seedOverride({
      D25: {
        department_code: "D25",
        department_name: "Millwork",
        categories: [
          { name: "Shop Built", slug: "shop-built", subcategories: ["Jambs"] },
        ],
      },
    });
    const serverView = getTaxonomyForDepartment("D25", "Millwork", {
      includeOverrides: false,
    });
    expect(serverView).toEqual(getDefaultTaxonomy("D25", "Millwork"));
  });
});

describe("no generative catalog taxonomy path remains", () => {
  it("has no AI taxonomy route or module", () => {
    expect(existsSync(path.join(root, "app/api/catalog/ai-taxonomy"))).toBe(false);
    expect(existsSync(path.join(root, "lib/catalog/ai-taxonomy.ts"))).toBe(false);
  });

  it("keeps the registry free of Gemini imports", () => {
    const source = readRepo("lib/catalog/taxonomies.ts");
    expect(source).not.toMatch(/lib\/ai\/gemini|asGeminiSchema/);
  });

  it("leaves no writer for taxonomy overrides", () => {
    expect(readRepo("lib/catalog/taxonomies.ts")).not.toMatch(
      /saveTaxonomyOverride/
    );
  });

  it("removes the generate interaction and AI copy from the manager", () => {
    const modal = readRepo("components/catalog/TaxonomyManagerModal.tsx");
    expect(modal).not.toMatch(/ai-taxonomy|Generate|Gemini|AI Taxonomy/i);
    expect(modal).not.toMatch(/fetch\(/);
  });

  it("drops the exclusively owned taxonomy token budget", () => {
    expect(readRepo("lib/ai/gemini.ts")).not.toMatch(/^\s*taxonomy:/m);
  });
});

describe("audit folder consumption is unchanged", () => {
  it("still exposes the drill-down tree the department audit reads", () => {
    const section = readRepo("components/sections/DepartmentAuditSection.tsx");
    expect(section).toMatch(/getTaxonomyForHubDepartment/);
    expect(section).toMatch(/deptsync:taxonomies-changed/);
    const taxonomy = getTaxonomyForHubDepartment("plumbing", {
      includeOverrides: false,
    });
    expect(taxonomy?.department_code).toBe("D26");
    expect(
      taxonomy?.categories.every((c) => c.subcategories.length > 0)
    ).toBe(true);
  });

  it("keeps appliance folders sourced from the appliance registry", () => {
    const appliances = DEFAULT_DEPARTMENT_TAXONOMIES.D35;
    expect(appliances.categories.length).toBeGreaterThan(0);
    expect(
      readRepo("lib/catalog/taxonomies.ts")
    ).toMatch(/APPLIANCE_CATEGORIES|APPLIANCE_SUBCATEGORIES/);
  });
});
