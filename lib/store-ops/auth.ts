/**
 * Hub session → Store Operations API authorization.
 * Composes existing MasterAdmin / Supervisor roles onto store-ops policies.
 * Does not invent competitive or inventory data.
 */

import type { DepartmentScope, StoreSpecialist } from "@/lib/types";
import { isMasterAdmin } from "@/lib/rbac";
import type { StoreOpsUserRole } from "./types";

export type StoreOpsActor = {
  specialistId: string;
  role: StoreOpsUserRole;
  /** Hub department scope code (maps to departments.code). */
  departmentCode: string | null;
};

export function actorFromSpecialist(
  member: StoreSpecialist | null | undefined
): StoreOpsActor | null {
  if (!member) return null;
  if (isMasterAdmin(member)) {
    return {
      specialistId: member.id,
      role: "super_admin",
      departmentCode: null,
    };
  }
  if (member.role === "Supervisor") {
    const code = member.assigned_department;
    if (!code || code === "all") return null;
    return {
      specialistId: member.id,
      role: "department_supervisor",
      departmentCode: code as DepartmentScope,
    };
  }
  return null;
}

export function storeOpsAuthHeaders(actor: StoreOpsActor): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-store-ops-role": actor.role,
    "x-store-ops-specialist-id": actor.specialistId,
    ...(actor.departmentCode
      ? { "x-store-ops-department-code": actor.departmentCode }
      : {}),
  };
}

export function parseStoreOpsActor(request: Request): StoreOpsActor | null {
  const role = request.headers.get("x-store-ops-role");
  const specialistId = request.headers.get("x-store-ops-specialist-id");
  const departmentCode = request.headers.get("x-store-ops-department-code");

  if (!specialistId) return null;
  if (role === "super_admin") {
    return { specialistId, role: "super_admin", departmentCode: null };
  }
  if (role === "department_supervisor" && departmentCode) {
    return {
      specialistId,
      role: "department_supervisor",
      departmentCode,
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
