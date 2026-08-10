/**
 * Hub session → Store Operations API authorization.
 * Composes MasterAdmin / Supervisor / Associate onto store-ops policies.
 * Does not invent competitive or inventory data.
 */

import type { DepartmentScope, StoreSpecialist } from "@/lib/types";
import { isMasterAdmin } from "@/lib/rbac";
import { normalizeStoreNumber } from "@/lib/store";
import { toStoreOpsDepartmentCode } from "./department-codes";
import type { StoreOpsUserRole } from "./types";

export type StoreOpsActor = {
  specialistId: string;
  role: StoreOpsUserRole;
  /** Store-ops departments.code (Lowe's / mapped hub scope). */
  departmentCode: string | null;
  /** Hub store_number for multi-store scoping. */
  storeNumber: string;
};

export function actorFromSpecialist(
  member: StoreSpecialist | null | undefined,
  storeNumber?: string | null
): StoreOpsActor | null {
  if (!member) return null;
  const store = normalizeStoreNumber(
    storeNumber?.trim() || member.store_number?.trim() || ""
  );
  if (!store) return null;
  if (isMasterAdmin(member)) {
    return {
      specialistId: member.id,
      role: "super_admin",
      departmentCode: null,
      storeNumber: store,
    };
  }
  if (member.role === "Supervisor" || member.role === "Associate") {
    const code = toStoreOpsDepartmentCode(
      member.assigned_department as DepartmentScope | string | null
    );
    if (!code) return null;
    return {
      specialistId: member.id,
      role:
        member.role === "Associate" ? "associate" : "department_supervisor",
      departmentCode: code,
      storeNumber: store,
    };
  }
  return null;
}

/** Dept-scoped floor actors: supervisors + associates (not super admin). */
export function isDeptFloorActor(
  actor: StoreOpsActor | null | undefined
): boolean {
  return (
    actor?.role === "department_supervisor" || actor?.role === "associate"
  );
}

export function storeOpsAuthHeaders(actor: StoreOpsActor): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-store-ops-role": actor.role,
    "x-store-ops-specialist-id": actor.specialistId,
    "x-store-ops-store-number": actor.storeNumber,
    ...(actor.departmentCode
      ? { "x-store-ops-department-code": actor.departmentCode }
      : {}),
  };
}

export function parseStoreOpsActor(request: Request): StoreOpsActor | null {
  const role = request.headers.get("x-store-ops-role");
  const specialistId = request.headers.get("x-store-ops-specialist-id");
  const departmentCode = request.headers.get("x-store-ops-department-code");
  const storeNumber = normalizeStoreNumber(
    request.headers.get("x-store-ops-store-number") || ""
  );

  if (!specialistId || !storeNumber) return null;
  if (role === "super_admin") {
    return {
      specialistId,
      role: "super_admin",
      departmentCode: null,
      storeNumber,
    };
  }
  if (
    (role === "department_supervisor" || role === "associate") &&
    departmentCode
  ) {
    return {
      specialistId,
      role: role as "department_supervisor" | "associate",
      departmentCode,
      storeNumber,
    };
  }
  return null;
}

export function requireSuperAdmin(actor: StoreOpsActor | null): StoreOpsActor {
  if (!actor || actor.role !== "super_admin") {
    throw new StoreOpsAuthError("Super admin required", 403);
  }
  return actor;
}

/** Supervisor or Master Admin — not Associates (targets, location admin). */
export function requireSupervisorOrAdmin(
  actor: StoreOpsActor | null
): StoreOpsActor {
  if (
    !actor ||
    (actor.role !== "super_admin" && actor.role !== "department_supervisor")
  ) {
    throw new StoreOpsAuthError("Supervisor or super admin required", 403);
  }
  return actor;
}

export function requireStoreOpsActor(actor: StoreOpsActor | null): StoreOpsActor {
  if (!actor) {
    throw new StoreOpsAuthError("Unauthorized", 401);
  }
  return actor;
}

export class StoreOpsAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
