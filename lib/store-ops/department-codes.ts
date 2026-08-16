/**
 * Maps hub DepartmentScope → departments.code (Lowe's / store-ops codes).
 */

import type { DepartmentScope } from "@/lib/types";

/** Canonical store-ops department codes used in public.departments.code */
export const STORE_OPS_DEPARTMENT_CODES = [
  "flooring",
  "appliances",
  "plumbing",
  "electrical",
  "D24P",
  "D28I",
  "D28O",
  "D30",
  "D29",
  "D25",
  "building_materials",
] as const;

export type StoreOpsDepartmentCode =
  (typeof STORE_OPS_DEPARTMENT_CODES)[number];

const HUB_TO_CODE: Record<string, StoreOpsDepartmentCode> = {
  flooring: "flooring",
  D23: "flooring",
  appliances: "appliances",
  D35: "appliances",
  plumbing: "plumbing",
  D26: "plumbing",
  electrical: "electrical",
  D24: "electrical",
  paint: "D24P",
  D24P: "D24P",
  lawn_garden: "D28I",
  inside_garden: "D28I",
  D28I: "D28I",
  D28: "D28I",
  outside_garden: "D28O",
  D28O: "D28O",
  millwork: "D30",
  D30: "D30",
  cabinets: "D29",
  D29: "D29",
  hardware: "D25",
  tools: "D25",
  D25: "D25",
  building_materials: "building_materials",
  D21: "building_materials",
};

export function toStoreOpsDepartmentCode(
  hubOrCode: string | null | undefined
): string | null {
  if (!hubOrCode || hubOrCode === "all") return null;
  return HUB_TO_CODE[hubOrCode] ?? hubOrCode;
}

export function storeOpsDepartmentSortIndex(code: string): number {
  const i = (STORE_OPS_DEPARTMENT_CODES as readonly string[]).indexOf(code);
  return i === -1 ? 999 : i;
}

export function hubScopeFromDeptCode(code: string): DepartmentScope | null {
  const reverse: Record<string, DepartmentScope> = {
    flooring: "flooring",
    D23: "flooring",
    appliances: "appliances",
    D35: "appliances",
    plumbing: "plumbing",
    D26: "plumbing",
    electrical: "electrical",
    D24: "electrical",
    D24P: "paint",
    D28I: "inside_garden",
    D28: "inside_garden",
    D28O: "outside_garden",
    D30: "millwork",
    D29: "cabinets",
    D25: "tools",
    D21: "building_materials",
    building_materials: "building_materials",
  };
  return reverse[code] ?? reverse[toStoreOpsDepartmentCode(code) ?? ""] ?? null;
}

/** True when two department codes/slugs are the same hub department (flooring ≡ D23). */
export function departmentCodesMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const a = String(left ?? "").trim();
  const b = String(right ?? "").trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const canonA = toStoreOpsDepartmentCode(a);
  const canonB = toStoreOpsDepartmentCode(b);
  if (canonA && canonB && canonA.toLowerCase() === canonB.toLowerCase()) {
    return true;
  }
  const scopeA = hubScopeFromDeptCode(a) ?? hubScopeFromDeptCode(canonA ?? "");
  const scopeB = hubScopeFromDeptCode(b) ?? hubScopeFromDeptCode(canonB ?? "");
  return Boolean(scopeA && scopeB && scopeA === scopeB);
}

/** departments.id for the working pin — Lowe's codes and hub slugs share a family. */
export function matchDepartmentIdByCode(
  departments: Array<{ id: string; code: string }>,
  codeOrScope: string | null | undefined
): string | undefined {
  const needle = String(codeOrScope ?? "").trim();
  if (!needle) return undefined;
  const exact = departments.find((row) => row.code === needle);
  if (exact) return exact.id;
  return departments.find((row) => departmentCodesMatch(row.code, needle))?.id;
}

export function departmentIdsMatchingCode(
  departments: Array<{ id: string; code: string }>,
  codeOrScope: string | null | undefined
): string[] {
  const needle = String(codeOrScope ?? "").trim();
  if (!needle) return [];
  const seed =
    departments.find((row) => row.id === needle) ??
    departments.find((row) => departmentCodesMatch(row.code, needle));
  if (!seed) return [];
  return departments
    .filter(
      (row) => row.id === seed.id || departmentCodesMatch(row.code, seed.code)
    )
    .map((row) => row.id);
}

/** Values for `.in("department", …)` so flooring/D23 (and siblings) share a family. */
export function departmentCodeQueryValues(
  codeOrScope: string | null | undefined
): string[] {
  const needle = String(codeOrScope ?? "").trim();
  if (!needle) return [];
  const out = new Set<string>([needle]);
  const canon = toStoreOpsDepartmentCode(needle);
  if (canon) out.add(canon);
  for (const [alias, mapped] of Object.entries(HUB_TO_CODE)) {
    if (
      departmentCodesMatch(alias, needle) ||
      departmentCodesMatch(mapped, needle)
    ) {
      out.add(alias);
      out.add(mapped);
    }
  }
  return [...out];
}
