/**
 * AI Catalog Taxonomy Generator — owns prompt, normalize, and local fallback.
 * Composes lib/catalog/taxonomies defaults; Gemini owns transport only.
 */

import {
  getDefaultTaxonomy,
  mergeTaxonomies,
  normalizeDepartmentTaxonomy,
  normalizeTaxonomyCode,
  type DepartmentTaxonomy,
} from "@/lib/catalog/taxonomies";

export type AiTaxonomyResult = DepartmentTaxonomy & {
  source: "gemini" | "local";
};

export function buildTaxonomyPrompt(input: {
  department_code: string;
  department_name: string;
}): string {
  const code = normalizeTaxonomyCode(input.department_code) || input.department_code;
  const name = input.department_name.trim() || "Department";

  return `You are DeptSync Hub's catalog taxonomy generator for a Lowe's retail store.

Generate a practical category taxonomy for department ${code} (${name}).
Use standard Lowe's / big-box retail merchandising folders — not invent fictional SKUs.

Return ONLY valid JSON (no markdown fences) in this exact shape:
{
  "department_code": "${code}",
  "department_name": "${name}",
  "categories": [
    {
      "name": "Doors",
      "slug": "doors",
      "subcategories": ["Interior Doors", "Exterior Doors", "Patio Doors", "Screen & Storm Doors"]
    },
    {
      "name": "Moulding & Millwork",
      "slug": "moulding-millwork",
      "subcategories": ["Baseboard", "Crown Moulding", "Casing", "PVC Moulding"]
    }
  ]
}

Rules:
- 4–8 top-level categories
- Each category needs a kebab-case slug and 3–8 subcategories
- Prefer common floor-walk language associates recognize
- Do not include pricing, recommendations, or SKU lists`;
}

export function normalizeAiTaxonomy(
  raw: unknown,
  departmentCode: string,
  departmentName: string
): DepartmentTaxonomy {
  return normalizeDepartmentTaxonomy(raw, departmentCode, departmentName);
}

/** Deterministic fallback when Gemini is unavailable — registry defaults. */
export function buildLocalTaxonomy(
  departmentCode: string,
  departmentName: string
): DepartmentTaxonomy {
  return getDefaultTaxonomy(departmentCode, departmentName);
}

/**
 * Prefer AI tree expanded onto defaults so known folders are never dropped.
 */
export function composeTaxonomyWithDefaults(
  aiOrLocal: DepartmentTaxonomy,
  departmentCode: string,
  departmentName: string
): DepartmentTaxonomy {
  const defaults = getDefaultTaxonomy(departmentCode, departmentName);
  return mergeTaxonomies(defaults, aiOrLocal);
}
