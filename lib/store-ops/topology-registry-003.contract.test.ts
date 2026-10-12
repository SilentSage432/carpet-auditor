/**
 * DEPTSYNC-TOPOLOGY-REGISTRY-003 — Create Location + Map registry merge contracts.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { composeMapAisleIndex, formatMapAisleLabel } from "./map-aisle-navigation";
import { formatAisleBayCount } from "./map-coverage-presentation";
import {
  composeDepartmentAisleIndexForSections,
  composeSectionAisleMembershipPreview,
  expandAisleToActiveBayRefs,
} from "./section-aisle-membership";
import {
  normalizeStoreAisleCode,
  validateStoreAisleIdentifier,
} from "./store-aisles";
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
  {
    id: "d2",
    store_id: "s1",
    name: "Paint",
    code: "paint",
    weekly_bay_target: 12,
    is_active: true,
  } as Department,
];

describe("REGISTRY-003 identifier validation", () => {
  it("accepts numeric aisles and named zones", () => {
    expect(validateStoreAisleIdentifier({ aisle: "41" })).toMatchObject({
      ok: true,
      aisle: "41",
    });
    expect(
      validateStoreAisleIdentifier({
        aisle: "carpet-wall",
        display_name: " Carpet Wall ",
      })
    ).toEqual({
      ok: true,
      aisle: "CARPET-WALL",
      display_name: "Carpet Wall",
    });
    expect(normalizeStoreAisleCode("012")).toBe("12");
    expect(normalizeStoreAisleCode("SHOW-L")).toBe("SHOW-L");
  });

  it("rejects empty and malformed identifiers", () => {
    expect(validateStoreAisleIdentifier({ aisle: "   " }).ok).toBe(false);
    expect(validateStoreAisleIdentifier({ aisle: "" }).ok).toBe(false);
    expect(validateStoreAisleIdentifier({ aisle: "BAD*" }).ok).toBe(false);
  });
});

describe("REGISTRY-003 Map registry ∪ bay merge", () => {
  it("keeps legacy bay aisles when registry is empty", () => {
    const index = composeMapAisleIndex({
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
      registryAisles: [],
    });
    expect(index.map((e) => e.aisle)).toEqual(["41"]);
    expect(index[0]?.registryOnly).toBe(false);
  });

  it("shows empty registered named zones with zero bays", () => {
    const index = composeMapAisleIndex({
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
          display_name: "Carpet Wall",
          is_active: true,
        },
        {
          store_id: "s1",
          department_id: "d1",
          aisle: "SHOW-L",
          is_active: true,
        },
      ],
    });
    expect(index.map((e) => e.aisle).sort()).toEqual([
      "41",
      "CARPET-WALL",
      "SHOW-L",
    ]);
    const wall = index.find((e) => e.aisle === "CARPET-WALL");
    expect(wall?.physicalBayCount).toBe(0);
    expect(wall?.registryOnly).toBe(true);
    expect(formatMapAisleLabel(wall!)).toBe("Carpet Wall");
    expect(formatAisleBayCount(0)).toBe("0 documented bays");
  });

  it("does not duplicate when registry and bays share an aisle", () => {
    const index = composeMapAisleIndex({
      locations: [
        loc({
          id: "1",
          department_id: "d1",
          aisle: "41",
          bay: 1,
          type: "SELLING",
        }),
        loc({
          id: "2",
          department_id: "d1",
          aisle: "41",
          bay: 1,
          type: "TOPSTOCK",
        }),
      ],
      departments: depts,
      registryAisles: [
        {
          store_id: "s1",
          department_id: "d1",
          aisle: "41",
          display_name: null,
          is_active: true,
        },
      ],
    });
    expect(index.filter((e) => e.aisle === "41")).toHaveLength(1);
    expect(index[0]?.physicalBayCount).toBe(1);
    expect(index[0]?.registryOnly).toBe(false);
  });

  it("hides retired registry shells unless showRetired", () => {
    const registry = [
      {
        store_id: "s1",
        department_id: "d1",
        aisle: "CLOTHING",
        is_active: false,
        retired_at: "2026-01-01T00:00:00Z",
      },
    ];
    const active = composeMapAisleIndex({
      locations: [],
      departments: depts,
      registryAisles: registry,
    });
    expect(active).toHaveLength(0);
    const withRetired = composeMapAisleIndex({
      locations: [],
      departments: depts,
      registryAisles: registry,
      showRetired: true,
    });
    expect(withRetired.map((e) => e.aisle)).toEqual(["CLOTHING"]);
  });

  it("allows same code in two departments without merging", () => {
    const index = composeMapAisleIndex({
      locations: [],
      departments: depts,
      registryAisles: [
        {
          store_id: "s1",
          department_id: "d1",
          aisle: "5",
          is_active: true,
        },
        {
          store_id: "s1",
          department_id: "d2",
          aisle: "5",
          is_active: true,
        },
      ],
    });
    expect(index).toHaveLength(2);
    expect(index.every((e) => e.aisleCodeCollides)).toBe(true);
  });
});

describe("REGISTRY-003 sections + rotation safety", () => {
  it("lists empty registry aisles but expands to zero memberships", () => {
    const aisleIndex = composeDepartmentAisleIndexForSections({
      locations: [],
      departments: depts,
      departmentId: "d1",
      registryAisles: [
        {
          department_id: "d1",
          aisle: "SHOW-R",
          is_active: true,
        },
      ],
    });
    expect(aisleIndex).toHaveLength(1);
    expect(expandAisleToActiveBayRefs(aisleIndex[0]!)).toEqual([]);
    const preview = composeSectionAisleMembershipPreview({
      aisleIndex,
      selectedAisleKeys: [aisleIndex[0]!.key],
      claimedByKey: new Map(),
    });
    expect(preview.total_bays_to_add).toBe(0);
    expect(preview.zero_active_aisles.length).toBe(1);
  });

  it("does not wire store_aisles into Sunday dispatch or capacity RPC", () => {
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(dispatch).not.toMatch(/store_aisles|createStoreAisle|registryAisles/);
    const capacity = readRepo(
      "supabase/migrations/20261014_capacity_guard_002_store_week_lock.sql"
    );
    expect(capacity).not.toMatch(/store_aisles/);
    const sectionAware = readRepo("lib/store-ops/section-aware-rotation.ts");
    expect(sectionAware).toMatch(/SECTION_AWARE_ROTATION_AUTO_STAGE\s*=\s*false/);
  });
});

describe("REGISTRY-003 API + UI wiring", () => {
  it("exposes MasterAdmin create API without client write policies", () => {
    const route = readRepo("app/api/store-aisles/route.ts");
    expect(route).toMatch(/requireSuperAdmin/);
    expect(route).toMatch(/createStoreAisleRecord/);
    expect(route).toMatch(/Cross-store mutation is not allowed/);
    expect(route).not.toMatch(/using\s*\(\s*true\s*\)/);

    const migration = readRepo(
      "supabase/migrations/20261015_store_aisles_registry.sql"
    );
    expect(migration).toMatch(
      /revoke insert, update, delete, truncate, references, trigger on table public\.store_aisles from authenticated/i
    );
  });

  it("wires Create Location UI and Map empty experience", () => {
    const manager = readRepo("components/admin/AisleBayManager.tsx");
    expect(manager).toMatch(/Create Location/);
    expect(manager).toMatch(/CreateLocationSheet/);
    expect(manager).toMatch(/isMasterAdmin/);

    const sheet = readRepo("components/admin/CreateLocationSheet.tsx");
    expect(sheet).toMatch(/createStoreAisle/);
    expect(sheet).toMatch(/0 documented bays/);
    expect(sheet).not.toMatch(/start_bay|end_bay/);

    const grid = readRepo("components/admin/StoreLocationGrid.tsx");
    expect(grid).toMatch(/registryAisles/);
    expect(grid).toMatch(/map-empty-location/);
    expect(grid).toMatch(/Add Bays/);

    const bulk = readRepo("app/api/store-locations/bulk/route.ts");
    expect(bulk).toMatch(/ensureStoreAisleForBayWrite/);
  });
});
