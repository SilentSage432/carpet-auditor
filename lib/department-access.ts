/**
 * Multi-department access composition.
 * Primary assigned_department stays the home department; this list is
 * primary + granted cross-department scopes. Presentation consumes;
 * specialists.ts / profiles persist.
 */

import { toStoreOpsDepartmentCode } from "@/lib/store-ops/department-codes";
import {
  OPERATIONAL_DEPARTMENTS,
  parseDepartmentScope,
  type DepartmentScope,
  type OperationalDepartment,
  type StoreSpecialist,
} from "@/lib/types";

export function isOperationalDepartment(
  value: string | null | undefined
): value is OperationalDepartment {
  return (
    !!value &&
    value !== "all" &&
    (OPERATIONAL_DEPARTMENTS as readonly string[]).includes(value)
  );
}

export function parseAccessibleDepartments(
  raw: unknown
): OperationalDepartment[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,[\]]/).map((part) => part.trim())
      : [];
  const seen = new Set<OperationalDepartment>();
  for (const value of values) {
    const token = String(value ?? "")
      .trim()
      .replace(/^"+|"+$/g, "");
    if (!token || token === "all") continue;
    const scope = parseDepartmentScope(token);
    if (scope && isOperationalDepartment(scope)) seen.add(scope);
  }
  return OPERATIONAL_DEPARTMENTS.filter((dept) => seen.has(dept));
}

/** Primary first, then granted extras. Never includes `all`. */
export function composeAccessibleDepartments(
  primary: DepartmentScope | null | undefined,
  granted?: unknown
): OperationalDepartment[] {
  const extras = parseAccessibleDepartments(granted);
  const home =
    primary && primary !== "all" && isOperationalDepartment(primary)
      ? primary
      : null;
  const seen = new Set<OperationalDepartment>();
  const next: OperationalDepartment[] = [];
  if (home) {
    seen.add(home);
    next.push(home);
  }
  for (const dept of extras) {
    if (seen.has(dept)) continue;
    seen.add(dept);
    next.push(dept);
  }
  return next;
}

export function accessibleDepartments(
  member: StoreSpecialist | null | undefined
): OperationalDepartment[] {
  if (!member) return [];
  if (member.role === "MasterAdmin") {
    return [...OPERATIONAL_DEPARTMENTS];
  }
  return composeAccessibleDepartments(
    member.assigned_department,
    member.accessible_departments
  );
}

export function canAccessDepartment(
  member: StoreSpecialist | null | undefined,
  scope: DepartmentScope | string | null | undefined
): boolean {
  if (!member || !scope) return false;
  if (member.role === "MasterAdmin") return true;
  if (scope === "all") return false;
  const parsed = parseDepartmentScope(scope);
  const needle =
    parsed && isOperationalDepartment(parsed)
      ? parsed
      : isOperationalDepartment(scope)
        ? scope
        : null;
  if (!needle) return false;
  return accessibleDepartments(member).includes(needle);
}

export function accessibleStoreOpsCodes(
  member: StoreSpecialist | null | undefined
): string[] {
  const codes = new Set<string>();
  for (const scope of accessibleDepartments(member)) {
    const code = toStoreOpsDepartmentCode(scope);
    if (code) codes.add(code);
  }
  return [...codes];
}

export function hasMultipleDepartmentAccess(
  member: StoreSpecialist | null | undefined
): boolean {
  if (!member || member.role === "MasterAdmin") return false;
  return accessibleDepartments(member).length > 1;
}
