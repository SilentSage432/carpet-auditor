/**
 * DEPTSYNC-CLEANUP-003 — release verification contracts.
 * Authorization boundaries, soft-only mutations, Map/eligibility integration.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composeMapAisleIndex } from "./map-aisle-navigation";
import { isEligibleRotationLocation } from "./location-eligibility";
import {
  composeCleanupAssociateInventory,
  isProtectedCleanupRole,
} from "./workspace-cleanup";
import type { Department, StoreLocation } from "./types";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("CLEANUP-003 route authorization contracts", () => {
  const route = readRepo("app/api/workspace-cleanup/route.ts");
  const core = readRepo("lib/store-ops/workspace-cleanup.ts");
  const wizard = readRepo("components/admin/WorkspaceCleanupWizard.tsx");
  const settings = readRepo("components/sections/SettingsSection.tsx");

  it("enforces MasterAdmin server-side on GET and POST", () => {
    expect(route).toMatch(/resolveStoreOpsActor/);
    expect(route).toMatch(/requireSuperAdmin\(actor\)/);
    expect(route.match(/requireSuperAdmin\(actor\)/g)?.length).toBeGreaterThanOrEqual(
      2
    );
  });

  it("scopes store from actor, not client body elevation fields", () => {
    expect(route).toMatch(/actor\.storeNumber/);
    expect(route).toMatch(/resolveStoreByNumber\(supabase, actor\.storeNumber\)/);
    expect(route).not.toMatch(/body\.store_number/);
    expect(route).not.toMatch(/body\.store_id/);
    expect(route).not.toMatch(/body\.role/);
    expect(route).toMatch(/Aisle department is outside this store/);
  });

  it("requires confirm + fingerprint for mutate actions", () => {
    expect(route).toMatch(/confirm: true is required to retire aisles/);
    expect(route).toMatch(/confirm: true is required to archive associates/);
    expect(route).toMatch(/Preview fingerprint is required/);
    expect(core).toMatch(/liveFingerprint !== input\.fingerprint/);
    expect(core).toMatch(/built\.preview\.fingerprint !== input\.fingerprint/);
  });

  it("never hard-deletes and never writes credentials", () => {
    expect(route).not.toMatch(/\.delete\(\)/);
    expect(core).not.toMatch(/\.delete\(\)/);
    expect(core).not.toMatch(/pin_code|pin_hash|password|auth_user_id/);
    expect(core).toMatch(/\.update\(\{ is_active: false \}\)/);
    expect(core).toMatch(
      /\.update\(\{ is_active: false, status: "suspended" \}\)/
    );
  });

  it("protects MasterAdmin and keeps entry Master-only in More", () => {
    expect(core).toMatch(/MasterAdmin identity cannot be archived/);
    expect(core).toMatch(/\.neq\("role", "MasterAdmin"\)/);
    expect(isProtectedCleanupRole("MasterAdmin")).toBe(true);
    expect(settings).toMatch(/more-workspace-cleanup/);
    expect(settings).toMatch(/showMasterAdmin/);
    expect(wizard).toMatch(/isMasterAdmin/);
    expect(wizard).toMatch(/MasterAdmin is never listed/);
  });

  it("wizard does not mutate on open — inventory GET only until confirm", () => {
    expect(wizard).toMatch(/fetchWorkspaceCleanupInventory/);
    expect(wizard).toMatch(/aisleConfirm/);
    expect(wizard).toMatch(/associateConfirm/);
    expect(wizard).toMatch(/retireWorkspaceCleanupAisles/);
    expect(wizard).toMatch(/archiveWorkspaceCleanupAssociates/);
    // Mutations gated behind confirm flags in handlers
    expect(wizard).toMatch(/if \(!aislePreview \|\| !aisleConfirm\) return/);
    expect(wizard).toMatch(
      /if \(!associatePreview \|\| !associateConfirm\) return/
    );
  });
});

describe("CLEANUP-003 Map + eligibility after soft-retire", () => {
  const departments: Department[] = [
    {
      id: "d1",
      store_id: "s1",
      code: "flooring",
      name: "Flooring",
      weekly_bay_target: 10,
      is_active: true,
    },
  ];

  it("hides fully retired aisles from active Map and keeps them with Show retired", () => {
    const active: StoreLocation = {
      id: "l1",
      store_id: "s1",
      department_id: "d1",
      aisle: "99",
      bay: 1,
      type: "SELLING",
      status: "PENDING",
      is_active: true,
      cycle_number: 1,
    } as StoreLocation;
    const retired = { ...active, is_active: false };

    const before = composeMapAisleIndex({
      locations: [active],
      departments,
      showRetired: false,
    });
    expect(before.some((e) => e.aisle === "99")).toBe(true);

    const afterActive = composeMapAisleIndex({
      locations: [retired],
      departments,
      showRetired: false,
    });
    expect(afterActive.some((e) => e.aisle === "99")).toBe(false);

    const afterRetired = composeMapAisleIndex({
      locations: [retired],
      departments,
      showRetired: true,
    });
    expect(afterRetired.some((e) => e.aisle === "99")).toBe(true);
  });

  it("excludes soft-retired surfaces from rotation eligibility without parent aisle column", () => {
    // No separate aisle.is_active — eligibility is per store_locations row.
    expect(
      isEligibleRotationLocation({ is_active: true, location_type: "STANDARD" })
    ).toBe(true);
    expect(
      isEligibleRotationLocation({
        is_active: false,
        location_type: "STANDARD",
      })
    ).toBe(false);
  });
});

describe("CLEANUP-003 associate archival presentation filters", () => {
  it("marks archived rows inactive and MasterAdmin protected", () => {
    const rows = composeCleanupAssociateInventory([
      {
        id: "a1",
        name: "Alex",
        role: "Associate",
        is_active: false,
        status: "suspended",
        assigned_department: "flooring",
      },
      {
        id: "m1",
        name: "Operator",
        role: "MasterAdmin",
        is_active: true,
        status: "active",
        assigned_department: "flooring",
      },
    ]);
    expect(rows.find((r) => r.id === "a1")?.rotation_eligible).toBe(false);
    expect(rows.find((r) => r.id === "m1")?.protected).toBe(true);
  });
});
