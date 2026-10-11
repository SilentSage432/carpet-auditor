/**
 * DEPTSYNC-RD-3 — Operational Sections contracts.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("RD-3 Operational Sections", () => {
  it("ships additive migration with one-bay unique + store-scoped RLS", () => {
    const path = "supabase/migrations/20261011_operational_sections.sql";
    expect(existsSync(join(root, path))).toBe(true);
    const sql = readSrc(path);
    expect(sql).toMatch(/create table if not exists public\.operational_sections/);
    expect(sql).toMatch(/create table if not exists public\.operational_section_members/);
    expect(sql).toMatch(/create table if not exists public\.operational_section_events/);
    expect(sql).toMatch(/operational_section_members_one_bay_idx/);
    expect(sql).toMatch(/normalize_operational_section_aisle/);
    expect(sql).toMatch(/regexp_replace\(upper\(trim/);
    expect(sql).toMatch(/on delete set null/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/Authenticated read operational sections/);
    expect(sql).toMatch(/jwt_matches_store/);
    expect(sql).not.toMatch(/for insert/);
    expect(sql).not.toMatch(/for update/);
    expect(sql).not.toMatch(/for delete/);
  });

  it("API mutations require Supervisor/Master; list requires store ops actor", () => {
    const list = readSrc("app/api/operational-sections/route.ts");
    expect(list).toMatch(/requireStoreOpsActor/);
    expect(list).toMatch(/requireSupervisorOrAdmin/);
    expect(list).toMatch(/assertActorCanAccessDepartmentId/);
    const one = readSrc("app/api/operational-sections/[id]/route.ts");
    expect(one).toMatch(/requireSupervisorOrAdmin/);
    expect(one).toMatch(/loadOperationalSectionForStore/);
    expect(one).toMatch(/assertActorCanAccessDepartmentId/);
    expect(one).toMatch(/retireOperationalSection/);
    expect(one).toMatch(/reactivateOperationalSection/);
    const members = readSrc(
      "app/api/operational-sections/[id]/members/route.ts"
    );
    expect(members).toMatch(/requireSupervisorOrAdmin/);
    expect(members).toMatch(/loadOperationalSectionForStore/);
    expect(members).toMatch(/assertActorCanAccessDepartmentId/);
    expect(members).toMatch(/addOperationalSectionMembers/);
    expect(members).toMatch(/removeOperationalSectionMembers/);
    expect(members).toMatch(/Ignored — store scope comes from the authenticated actor/);
  });

  it("domain remove/retire load store-scoped section before mutate", () => {
    const domain = readSrc("lib/store-ops/operational-sections.ts");
    expect(domain).toMatch(/export async function loadOperationalSectionForStore/);
    expect(domain).toMatch(
      /removeOperationalSectionMembers[\s\S]*loadOperationalSectionForStore/
    );
    expect(domain).toMatch(
      /retireOperationalSection[\s\S]*loadOperationalSectionForStore/
    );
    expect(domain).toMatch(/\.eq\("store_id", input\.store_id\)/);
  });

  it("does not rewrite Sunday rotation or capacity", () => {
    const domain = readSrc("lib/store-ops/operational-sections.ts");
    expect(domain).not.toMatch(/selectPhysicalBayCoverage/);
    expect(domain).not.toMatch(/sunday-dispatch/);
    expect(domain).not.toMatch(/weekly_rotations/);
    expect(domain).toMatch(/Does not select rotations/);
  });

  it("Map bay sheet shows real section or unsectioned", () => {
    const sheet = readSrc("components/admin/WalkTheFloorSheet.tsx");
    expect(sheet).toMatch(/walk-sheet-section-slot/);
    expect(sheet).toMatch(/baySection/);
    expect(sheet).toMatch(/walk-sheet-section-name/);
    expect(sheet).toMatch(/walk-sheet-section-unsectioned/);
    expect(sheet).toMatch(/Open section details/);
    expect(sheet).not.toMatch(/not stored in this release/);
  });

  it("More hosts section management with aisle-first bay picker", () => {
    const settings = readSrc("components/sections/SettingsSection.tsx");
    expect(settings).toMatch(/OperationalSectionsPanel/);
    expect(settings).toMatch(/operational-sections/);
    const panel = readSrc("components/admin/OperationalSectionsPanel.tsx");
    expect(panel).toMatch(/sections-bay-picker/);
    expect(panel).toMatch(
      /composeMapAisleIndex|composeDepartmentAisleIndexForSections|section-aisle-membership/
    );
    expect(panel).toMatch(/canManageOperationalSections/);
    expect(panel).not.toMatch(/toggleDept/);
  });

  it("Map loads section index without aisle-index clutter", () => {
    const map = readSrc("components/hub/tabs/MapTab.tsx");
    expect(map).toMatch(/fetchOperationalSections/);
    expect(map).toMatch(/baySectionByKey/);
    expect(map).toMatch(/indexBaySectionLookups/);
    const grid = readSrc("components/admin/StoreLocationGrid.tsx");
    expect(grid).toMatch(/baySectionByKey/);
    expect(grid).not.toMatch(/section chip on aisle tile/i);
  });
});
