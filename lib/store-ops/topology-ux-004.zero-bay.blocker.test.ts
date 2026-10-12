/**
 * DEPTSYNC-TOPOLOGY-UX-004 — zero-bay location creation evidence (historical).
 *
 * Originally locked the bay-row-only blocker. REGISTRY-002/003 add store_aisles
 * + Create Location — bay NOT NULL and “no fake bays” remain invariants.
 * Empty Map shells now come from registry merge (see REGISTRY-003 tests).
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { expandBayNumbers } from "./bay-pattern";
import { buildBulkLocationRows } from "./locations";
import { composeMapAisleIndex } from "./map-aisle-navigation";
import type { Department, StoreLocation } from "./types";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function loc(
  partial: Partial<StoreLocation> &
    Pick<StoreLocation, "id" | "department_id" | "aisle" | "bay" | "type">
): StoreLocation {
  return {
    store_id: "s1",
    status: "PENDING",
    is_active: true,
    cycle_number: 1,
    last_completed_at: null,
    location_type: "STANDARD",
    ...partial,
  } as StoreLocation;
}

const depts: Department[] = [
  {
    id: "d1",
    store_id: "s1",
    name: "Flooring",
    code: "flooring",
    weekly_bay_target: 12,
    is_active: true,
  } as Department,
];

describe("TOPOLOGY-UX-004 persistence blocker", () => {
  it("schema requires bay NOT NULL on store_locations", () => {
    const migration = readRepo(
      "supabase/migrations/20260809_store_operations_rbac.sql"
    );
    expect(migration).toMatch(/create table if not exists public\.store_locations/);
    expect(migration).toMatch(/bay integer not null check \(bay >= 0\)/);
    expect(migration).toMatch(
      /unique \(department_id, aisle, bay, type\)/
    );
  });

  it("alphanumeric aisle migration keeps bay in the unique key", () => {
    const migration = readRepo(
      "supabase/migrations/20260811_alphanumeric_aisle.sql"
    );
    expect(migration).toMatch(
      /unique \(department_id, aisle, bay, type\)/
    );
  });

  it("REGISTRY-002 adds store_aisles without area hierarchy tables", () => {
    const migrationsDir = path.join(root, "supabase/migrations");
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    const joined = files
      .map((f) => fs.readFileSync(path.join(migrationsDir, f), "utf8"))
      .join("\n");
    expect(joined).toMatch(
      /create table if not exists public\.store_aisles/
    );
    expect(joined).not.toMatch(
      /create table if not exists public\.(topology_areas|physical_areas|named_zones)\b/i
    );
  });
});

describe("TOPOLOGY-UX-004 bay-row invariants (still true after REGISTRY-003)", () => {
  it("Bulk Generator still creates physical bays (separate from Create Location)", () => {
    const bulk = readRepo("components/admin/BulkLocationGenerator.tsx");
    expect(bulk).toMatch(/Start Bay/);
    expect(bulk).toMatch(/End Bay/);
    expect(bulk).toMatch(/Create physical bays/);
    expect(bulk).toMatch(/expandBayNumbers/);
    // Empty shells are Create Location (store_aisles), not Bulk.
    expect(bulk).not.toMatch(/createStoreAisle/);
  });

  it("Add Bay sheet requires a bay integer before persist", () => {
    const sheet = readRepo("components/admin/AddBaySheet.tsx");
    expect(sheet).toMatch(/Bay must be an integer/);
    expect(sheet).toMatch(/start_bay: bayNumber/);
    expect(sheet).toMatch(/end_bay: bayNumber/);
  });

  it("bulk row builder cannot emit zero-bay location shells", () => {
    expect(() =>
      buildBulkLocationRows({
        store_id: "s1",
        department_id: "d1",
        aisle: "CARPET-WALL",
        start_bay: Number.NaN,
        end_bay: Number.NaN,
        types: ["SELLING", "TOPSTOCK"],
      })
    ).toThrow(/start_bay and end_bay are required/);

    expect(() => expandBayNumbers(1, 0, "odd")).toThrow(
      /start_bay must be ≤ end_bay/
    );

    const rows = buildBulkLocationRows({
      store_id: "s1",
      department_id: "d1",
      aisle: "CARPET-WALL",
      start_bay: 1,
      end_bay: 1,
      types: ["SELLING", "TOPSTOCK"],
      bay_pattern: "odd",
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.aisle === "CARPET-WALL")).toBe(true);
    expect(rows.every((r) => Number.isFinite(r.bay))).toBe(true);
  });

  it("Map index omits bay-less codes unless registry provides them", () => {
    const withoutRegistry = composeMapAisleIndex({
      locations: [
        loc({
          id: "1",
          department_id: "d1",
          aisle: "41",
          bay: 1,
          type: "SELLING",
        }),
      ],
      departments: depts,
    });
    expect(withoutRegistry.map((e) => e.aisle)).toEqual(["41"]);
    expect(
      withoutRegistry.find((e) => e.aisle === "CARPET-WALL")
    ).toBeUndefined();

    const withRegistry = composeMapAisleIndex({
      locations: [
        loc({
          id: "1",
          department_id: "d1",
          aisle: "41",
          bay: 1,
          type: "SELLING",
        }),
      ],
      departments: depts,
      registryAisles: [
        {
          store_id: "s1",
          department_id: "d1",
          aisle: "CARPET-WALL",
          is_active: true,
        },
      ],
    });
    expect(withRegistry.find((e) => e.aisle === "CARPET-WALL")?.physicalBayCount).toBe(
      0
    );
  });

  it("section aisle picker has zero-bay visibility copy but membership is bay-keyed", () => {
    const panel = readRepo("components/admin/OperationalSectionsPanel.tsx");
    expect(panel).toMatch(/zero_active_bays|no active bays/i);
    const members = readRepo("lib/store-ops/section-aisle-membership.ts");
    expect(members).toMatch(/expandAisleToActiveBayRefs/);
    expect(members).not.toMatch(/fabricat|placeholder bay/i);
  });

  it("does not invent fake bay rows for empty locations", () => {
    const sheet = readRepo("components/admin/CreateLocationSheet.tsx");
    expect(sheet).toMatch(/createStoreAisle/);
    expect(sheet).not.toMatch(/bay:\s*0|fake bay|placeholder bay/i);
    expect(sheet).not.toMatch(/start_bay|end_bay/);
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(dispatch).not.toMatch(/createStoreAisle|registryAisles/);
  });
});
