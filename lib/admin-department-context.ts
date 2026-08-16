/**
 * Master Admin working-department context — session pin only.
 * Does not change RBAC privileges (Master Admin stays full-store).
 * Presentation / filters compose via workingDepartment(); specialists ownership unchanged.
 */

import {
  DEPARTMENT_META,
  departmentRosterHeading,
  isDepartmentScope,
  type DepartmentScope,
  type OperationalDepartment,
  type StoreSpecialist,
} from "@/lib/types";
import { toStoreOpsDepartmentCode } from "@/lib/store-ops/department-codes";
import { accessibleDepartments } from "@/lib/department-access";
import { peekSandboxDepartment } from "@/lib/dev-sandbox";
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
  "cabinets",
  "building_materials",
  "tools",
  "inside_garden",
  "outside_garden",
];

export type AdminWorkingDepartment = OperationalDepartment | "all";

export function adminWorkingDepartmentLabel(
  dept: AdminWorkingDepartment
): string {
  return departmentRosterHeading(dept);
}

/** Compact header pill — department code only. */
export function adminWorkingDepartmentPillLabel(
  dept: AdminWorkingDepartment
): string {
  if (dept === "all") return "All";
  if (dept === "flooring") return "D23";
  if (dept === "appliances") return "D35";
  if (dept === "cabinets") return "D29";
  if (dept === "millwork") return "D30";
  if (dept === "paint") return "D24P";
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
 * Multi-department associates/supervisors: pinned scope when granted, else primary.
 * Single-department profiles: RBAC effectiveDepartment (unchanged).
 */
export function workingDepartment(
  member: StoreSpecialist | null | undefined
): DepartmentScope {
  if (!member) return "flooring";
  const sandboxDept = peekSandboxDepartment();
  if (sandboxDept) {
    if (isMasterAdmin(member)) {
      return sandboxDept;
    }
    if (sandboxDept !== "all") return sandboxDept;
  }
  if (isMasterAdmin(member)) return readAdminWorkingDepartment();
  const allowed = accessibleDepartments(member);
  if (allowed.length > 1) {
    const pin = readAdminWorkingDepartment();
    if (pin !== "all" && allowed.includes(pin)) return pin;
  }
  return effectiveDepartment(member);
}

export function isFlooringWorkingContext(
  member: StoreSpecialist | null | undefined
): boolean {
  const dept = workingDepartment(member);
  return dept === "flooring";
}

/** Store-ops departments.id for the current working pin, or undefined for all. */
export function workingDepartmentId(
  member: StoreSpecialist | null | undefined,
  departments: Array<{ id: string; code: string }>
): string | undefined {
  const scope = workingDepartment(member);
  if (!member || scope === "all") return undefined;
  const code = toStoreOpsDepartmentCode(scope);
  if (!code) return undefined;
  return departments.find((row) => row.code === code)?.id;
}

/** Prefer flooring hub section when Master Admin pins D23. */
export function preferredHubSectionForWorkingDept(
  dept: AdminWorkingDepartment
): "audit" | "appliances" | "department" | null {
  if (dept === "all") return null;
  if (dept === "flooring") return "audit";
  if (dept === "appliances") return "appliances";
  if (dept === "cabinets") return "department";
  return "department";
}
