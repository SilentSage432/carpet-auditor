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
  appliances: "appliances",
  plumbing: "plumbing",
  electrical: "electrical",
  paint: "D24P",
  D24P: "D24P",
  lawn_garden: "D28I",
  inside_garden: "D28I",
  D28I: "D28I",
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
    appliances: "appliances",
    plumbing: "plumbing",
    electrical: "electrical",
    D24P: "paint",
    D28I: "inside_garden",
    D28O: "outside_garden",
    D30: "millwork",
    D29: "cabinets",
    D25: "tools",
    building_materials: "building_materials",
  };
  return reverse[code] ?? null;
}
