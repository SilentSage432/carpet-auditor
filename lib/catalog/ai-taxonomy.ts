/**
 * AI Catalog Taxonomy Generator — owns prompt, normalize, and local fallback.
 * Composes lib/catalog/taxonomies defaults; Gemini owns transport only.
 */

import { asGeminiSchema } from "@/lib/ai/gemini-schema";
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

const taxonomyCategorySchema = asGeminiSchema({
  type: "object",
  properties: {
    name: { type: "string" },
    slug: { type: "string" },
    subcategories: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["name", "slug", "subcategories"],
});

/** Structured output for catalog taxonomy generation. */
export const TAXONOMY_RESPONSE_SCHEMA = asGeminiSchema({
  type: "object",
  properties: {
    department_code: { type: "string" },
    department_name: { type: "string" },
    categories: {
      type: "array",
      items: taxonomyCategorySchema,
    },
  },
  required: ["department_code", "department_name", "categories"],
});

export function buildTaxonomyPrompt(input: {
  department_code: string;
  department_name: string;
}): string {
  const code = normalizeTaxonomyCode(input.department_code) || input.department_code;
  const name = input.department_name.trim() || "Department";
  const known = getDefaultTaxonomy(code, name);
  const packet = {
    department_code: code,
    department_name: name,
    known_folders: known.categories.map((c) => ({
      name: c.name,
      slug: c.slug,
      subcategories: c.subcategories,
    })),
  };

  return `You are DeptSync Hub's catalog taxonomy generator for a Lowe's retail store.

Expand the known folder packet for department ${code} (${name}) into a practical merchandising taxonomy.
Use standard Lowe's / big-box retail folders — do not invent fictional SKUs.
Keep known folder names when they still fit; add missing categories only when they are standard for this department.

Rules:
- 4–8 top-level categories
- Each category needs a kebab-case slug and 3–8 subcategories
- Prefer common floor-walk language associates recognize
- Do not include pricing, recommendations, or SKU lists

KNOWN FOLDERS PACKET:
${JSON.stringify(packet)}`;
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
