/**
 * Hub session → Store Operations API authorization.
 * Prefers Supabase Auth JWT → profiles (auth.users.id).
 * Specialist header bridge is retired — clients must send Authorization: Bearer.
 */

import type { DepartmentScope, StoreSpecialist } from "@/lib/types";
import { isMasterAdmin } from "@/lib/rbac";
import { normalizeStoreNumber } from "@/lib/store";
import { getRequestAuthUser } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
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
  const { getSupabaseAccessToken } = await import("@/lib/supabase/browser");
  const token = await getSupabaseAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

type ProfileRow = {
  id: string;
  role: string;
  assigned_department_id: string | null;
  store_number: string | null;
  specialist_id: string | null;
  departments?: { code?: string } | { code?: string }[] | null;
};

function mapProfileRole(role: string): StoreOpsUserRole | null {
  if (role === "super_admin") return "super_admin";
  if (role === "department_supervisor") return "department_supervisor";
  if (role === "associate") return "associate";
  return null;
}

/**
 * Resolve Store Ops actor from Supabase Auth session (cookie or Bearer).
 * Loads public.profiles linked to auth.users.id — no x-store-ops-* trust.
 */
export async function resolveStoreOpsActor(
  request: Request
): Promise<StoreOpsActor | null> {
  const auth = await getRequestAuthUser(request);
  if (!auth) return null;

  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data: profile, error } = await admin
    .from("profiles")
    .select(
      "id, role, assigned_department_id, store_number, specialist_id, departments:assigned_department_id(code)"
    )
    .eq("id", auth.user.id)
    .maybeSingle();

  if (error || !profile) return null;

  const row = profile as ProfileRow;
  const role = mapProfileRole(String(row.role ?? ""));
  if (!role) return null;

  const meta = auth.user.app_metadata ?? {};
  const claimStore = normalizeStoreNumber(
    String(meta.store_number ?? row.store_number ?? "")
  );
  if (!claimStore) return null;

  let departmentCode: string | null = null;
  if (role !== "super_admin") {
    const deptRel = row.departments;
    const fromJoin = Array.isArray(deptRel)
      ? deptRel[0]?.code
      : deptRel?.code;
    departmentCode =
      String(meta.department ?? fromJoin ?? "").trim() || null;
    if (!departmentCode) return null;
  }

  return {
    userId: row.id,
    specialistId: String(row.specialist_id ?? row.id),
    role,
    departmentCode: role === "super_admin" ? null : departmentCode,
    storeNumber: claimStore,
  };
}

/** @deprecated Use resolveStoreOpsActor — headers are not authoritative. */
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
      "Unauthorized — Supabase Auth session required (phone OTP / signed-in profile)",
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
