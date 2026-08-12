/**
 * Client-safe Store Ops auth helpers (roster → actor, Bearer headers).
 * Server-only resolution lives in `auth-server.ts` — do not import next/headers here.
 */

import type { DepartmentScope, StoreSpecialist } from "@/lib/types";
import { isMasterAdmin } from "@/lib/rbac";
import { normalizeStoreNumber } from "@/lib/store";
import { toStoreOpsDepartmentCode } from "./department-codes";
import type { StoreOpsUserRole } from "./types";

export type StoreOpsActor = {
  /** auth.users / profiles.id when resolved from Supabase Auth. */
  userId: string | null;
  specialistId: string;
  role: StoreOpsUserRole;
  /** Store-ops departments.code (Lowe's / mapped hub scope). */
  departmentCode: string | null;
  /** Hub store_number for multi-store scoping. */
  storeNumber: string;
};

/** Client UI gating from local specialist roster (not API auth). */
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
      userId: null,
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
      userId: null,
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

/**
 * @deprecated Prefer storeOpsAuthHeadersAsync — sync headers no longer carry trust.
 * Kept for rare call sites; returns Content-Type only.
 */
export function storeOpsAuthHeaders(_actor: StoreOpsActor): HeadersInit {
  return { "Content-Type": "application/json" };
}

/** Browser: Authorization Bearer from Supabase Auth session. */
export async function storeOpsAuthHeadersAsync(
  _actor?: StoreOpsActor | null
): Promise<HeadersInit> {
  const { getSupabaseAccessToken } = await import("@/lib/supabase/client");
  const token = await getSupabaseAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** @deprecated Use resolveStoreOpsActor from auth-server — headers are not authoritative. */
export function parseStoreOpsActor(_request: Request): StoreOpsActor | null {
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
    throw new StoreOpsAuthError(
      "Unauthorized — Hub PIN Auth session missing. Sign in again with your Hub PIN/password.",
      401
    );
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
