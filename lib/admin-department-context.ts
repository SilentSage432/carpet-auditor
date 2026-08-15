/**
 * Master Admin working-department context — session pin only.
 * Does not change RBAC privileges (Master Admin stays full-store).
 * Presentation / filters compose via workingDepartment(); specialists ownership unchanged.
 */

import {
  DEPARTMENT_META,
  isDepartmentScope,
  type DepartmentScope,
  type OperationalDepartment,
  type StoreSpecialist,
} from "@/lib/types";
import { effectiveDepartment, isMasterAdmin } from "@/lib/rbac";

const STORAGE_KEY = "deptsync_admin_working_department";
export const ADMIN_DEPT_CONTEXT_EVENT = "deptsync:admin-dept-context";

/** Departments Master Admin can pin as primary working context. */
export const ADMIN_PINNABLE_DEPARTMENTS: OperationalDepartment[] = [
  "flooring",
  "appliances",
  "plumbing",
  "electrical",
  "paint",
  "millwork",
  "building_materials",
  "tools",
];

export type AdminWorkingDepartment = OperationalDepartment | "all";

export function adminWorkingDepartmentLabel(
  dept: AdminWorkingDepartment
): string {
  if (dept === "all") return "Full Store";
  if (dept === "flooring") return "D23 · Flooring";
  if (dept === "appliances") return "D35 · Appliances";
  const meta = DEPARTMENT_META[dept];
  return meta ? `${meta.shortLabel}` : dept;
}

/** Compact header pill — department code only. */
export function adminWorkingDepartmentPillLabel(
  dept: AdminWorkingDepartment
): string {
  if (dept === "all") return "All";
  if (dept === "flooring") return "D23";
  if (dept === "appliances") return "D35";
  return DEPARTMENT_META[dept]?.shortLabel ?? dept;
}

export function readAdminWorkingDepartment(): AdminWorkingDepartment {
  if (typeof window === "undefined") return "all";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
    if (!raw || raw === "all") return "all";
    if (
      isDepartmentScope(raw) &&
      raw !== "all" &&
      (ADMIN_PINNABLE_DEPARTMENTS as readonly string[]).includes(raw)
    ) {
      return raw as OperationalDepartment;
    }
  } catch {
    /* ignore */
  }
  return "all";
}

export function setAdminWorkingDepartment(
  dept: AdminWorkingDepartment
): AdminWorkingDepartment {
  if (typeof window === "undefined") return dept;
  const next =
    dept === "all" ||
    (ADMIN_PINNABLE_DEPARTMENTS as readonly string[]).includes(dept)
      ? dept
      : "all";
  try {
    if (next === "all") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(
    new CustomEvent(ADMIN_DEPT_CONTEXT_EVENT, { detail: { department: next } })
  );
  return next;
}

/**
 * Effective working department for filters / staging priority.
 * Master Admin: pinned context when set, else "all".
 * Everyone else: RBAC effectiveDepartment (unchanged).
 */
export function workingDepartment(
  member: StoreSpecialist | null | undefined
): DepartmentScope {
  if (!member) return "flooring";
  if (!isMasterAdmin(member)) return effectiveDepartment(member);
  return readAdminWorkingDepartment();
}

export function isFlooringWorkingContext(
  member: StoreSpecialist | null | undefined
): boolean {
  const dept = workingDepartment(member);
  return dept === "flooring";
}

/** Prefer flooring hub section when Master Admin pins D23. */
export function preferredHubSectionForWorkingDept(
  dept: AdminWorkingDepartment
): "audit" | "appliances" | "department" | null {
  if (dept === "all") return null;
  if (dept === "flooring") return "audit";
  if (dept === "appliances") return "appliances";
  return "department";
}
