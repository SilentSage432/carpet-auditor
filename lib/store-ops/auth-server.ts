/**
 * Server-only Store Ops actor resolution (Supabase Auth → profiles).
 * Import from API routes / Server Components only — never from Client Components.
 */

import "server-only";

import type { User } from "@supabase/supabase-js";
import { normalizeStoreNumber } from "@/lib/store";
import {
  createSupabaseUserClient,
  getRequestAuthUser,
} from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import type { StoreOpsActor } from "./auth";
import type { StoreOpsUserRole } from "./types";

export type { StoreOpsActor } from "./auth";

export {
  isDeptFloorActor,
  requireStoreOpsActor,
  requireSuperAdmin,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
} from "./auth";

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

async function actorFromAuthUser(user: User): Promise<StoreOpsActor | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data: profile, error } = await admin
    .from("profiles")
    .select(
      "id, role, assigned_department_id, store_number, specialist_id, departments:assigned_department_id(code)"
    )
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile) return null;

  const row = profile as ProfileRow;
  const role = mapProfileRole(String(row.role ?? ""));
  if (!role) return null;

  const meta = user.app_metadata ?? {};
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

/**
 * Resolve Store Ops actor from Supabase Auth session (cookie or Bearer).
 * Loads public.profiles linked to auth.users.id — no x-store-ops-* trust.
 */
export async function resolveStoreOpsActor(
  request: Request
): Promise<StoreOpsActor | null> {
  const auth = await getRequestAuthUser(request);
  if (!auth) return null;
  return actorFromAuthUser(auth.user);
}

/**
 * Resolve actor from a Bearer access token (Server Actions / localStorage sessions).
 */
export async function resolveStoreOpsActorFromToken(
  accessToken: string
): Promise<StoreOpsActor | null> {
  const token = String(accessToken ?? "").trim();
  if (!token) return null;

  const client = createSupabaseUserClient(token);
  if (!client) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return actorFromAuthUser(data.user);
}
