/**
 * DEPTSYNC-TOPOLOGY-REGISTRY-003 — authorization / security contracts.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  requireSuperAdmin,
  StoreOpsAuthError,
  type StoreOpsActor,
} from "./auth";
import { validateStoreAisleIdentifier } from "./store-aisles";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function actor(role: StoreOpsActor["role"]): StoreOpsActor {
  return {
    userId: "u1",
    specialistId: "s1",
    role,
    departmentCode: role === "super_admin" ? null : "flooring",
    accessibleDepartmentCodes:
      role === "super_admin" ? [] : ["flooring"],
    storeNumber: "2587",
  };
}

describe("REGISTRY-003 security", () => {
  it("MasterAdmin passes requireSuperAdmin; others are rejected", () => {
    expect(requireSuperAdmin(actor("super_admin")).role).toBe("super_admin");
    expect(() => requireSuperAdmin(actor("department_supervisor"))).toThrow(
      StoreOpsAuthError
    );
    expect(() => requireSuperAdmin(actor("associate"))).toThrow(
      StoreOpsAuthError
    );
    expect(() => requireSuperAdmin(null)).toThrow(StoreOpsAuthError);
  });

  it("API route enforces auth, MasterAdmin, store scope, dept scope", () => {
    const route = readRepo("app/api/store-aisles/route.ts");
    expect(route).toMatch(/resolveStoreOpsActor/);
    expect(route).toMatch(/requireSuperAdmin/);
    expect(route).toMatch(/resolveStoreByNumber/);
    expect(route).toMatch(/\.eq\("store_id", store\.id\)/);
    expect(route).toMatch(/assertActorCanAccessDepartmentId/);
    expect(route).toMatch(/Cross-store mutation is not allowed/);
    expect(route).toMatch(/getSupabaseAdmin/);
    expect(route).not.toMatch(/SERVICE_ROLE_KEY/);
    expect(route).toMatch(/status:\s*401/);
  });

  it("duplicate and malformed identifiers are rejected before write", () => {
    expect(validateStoreAisleIdentifier({ aisle: "!!" }).ok).toBe(false);
    const create = readRepo("lib/store-ops/store-aisles.ts");
    expect(create).toMatch(/StoreAisleConflictError/);
    expect(create).toMatch(/exists but is retired/);
    expect(create).toMatch(/already exists in this department/);
    // Create path must not silently reactivate.
    expect(create).toMatch(/Reactivation is not available in this release/);
  });

  it("preserves fail-closed RLS (no authenticated writes)", () => {
    const migration = readRepo(
      "supabase/migrations/20261015_store_aisles_registry.sql"
    );
    expect(migration).toMatch(/enable row level security/);
    expect(migration).toMatch(/for select/);
    expect(migration).toMatch(/jwt_matches_store/);
    expect(migration).not.toMatch(
      /create policy[\s\S]*for (insert|update|delete)[\s\S]*to authenticated/i
    );
  });
});
