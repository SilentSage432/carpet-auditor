/**
 * PRIORITY-UX-002 — Manual coverage priority (Model A).
 *
 * High is durable selector pressure among owed/eligible physical bays.
 * High does not re-admit COMPLETED coverage or inflate weekly quota.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canMutateRotationPriority,
  canMutateStoreMap,
  isAssociate,
  isDepartmentSupervisor,
  isMasterAdmin,
} from "@/lib/rbac";
import { BASE_WEEKLY_BAY_QUOTA } from "./weekly-rotations";
import { resolveAutomaticWeeklyBayTarget } from "./week";
import {
  physicalBayIsOwed,
  physicalBayKey,
  selectPhysicalBayCoverage,
} from "./physical-bay";
import {
  composeAisleManualPriority,
  composePhysicalBayManualPriority,
  setPhysicalBayRotationPriority,
} from "./physical-bay-priority";
import { isCarryOverDrawLocation, isManualHighPriorityLocation } from "./rotation";
import type { StoreLocation } from "./types";
import type { StoreSpecialist } from "@/lib/types";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function loc(
  overrides: Partial<StoreLocation> & {
    id: string;
    aisle: string;
    bay: number;
  }
): StoreLocation {
  return {
    id: overrides.id,
    department_id: overrides.department_id ?? "dept-1",
    store_id: overrides.store_id ?? "store-1",
    store_number: overrides.store_number ?? "2587",
    aisle: overrides.aisle,
    bay: overrides.bay,
    type: overrides.type ?? "SELLING",
    location_type: overrides.location_type ?? "STANDARD",
    status: overrides.status ?? "PENDING",
    is_active: overrides.is_active ?? true,
    cycle_number: overrides.cycle_number ?? 1,
    velocity_tier: overrides.velocity_tier ?? "standard",
    priority_override: overrides.priority_override ?? false,
    manual_priority_count: overrides.manual_priority_count ?? 0,
    carried_over: overrides.carried_over ?? false,
    last_completed_at: overrides.last_completed_at ?? "2026-01-01T00:00:00Z",
    last_serviced_at: overrides.last_serviced_at ?? null,
    last_carried_over_at: overrides.last_carried_over_at ?? null,
    created_at: overrides.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-01-01T00:00:00Z",
  } as StoreLocation;
}

function member(
  overrides: Partial<StoreSpecialist> & Pick<StoreSpecialist, "id" | "role">
): StoreSpecialist {
  return {
    store_number: "1755",
    name: "Test",
    is_active: true,
    status: "active",
    assigned_department: "flooring",
    accessible_departments: ["flooring"],
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as StoreSpecialist;
}

type LocRow = {
  id: string;
  aisle: string;
  bay: number;
  type: string;
  location_type: string;
  is_active: boolean;
  priority_override: boolean;
  department_id: string;
};

function fakePriorityDb(rows: LocRow[]) {
  const store = rows.map((row) => ({ ...row }));
  let failUpdate = false;
  let disagreeAfterWrite = false;

  const client = {
    from(table: string) {
      if (table !== "store_locations") throw new Error(table);
      return {
        select() {
          const filters: Record<string, unknown> = {};
          const chain = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return chain;
            },
            in(col: string, ids: string[]) {
              return Promise.resolve({
                data: store.filter((row) =>
                  col === "id" ? ids.includes(row.id) : true
                ),
                error: null,
              });
            },
            then(resolve: (value: { data: LocRow[]; error: null }) => void) {
              const data = store.filter((row) => {
                if (
                  filters.department_id &&
                  row.department_id !== filters.department_id
                ) {
                  return false;
                }
                if (
                  typeof filters.is_active === "boolean" &&
                  row.is_active !== filters.is_active
                ) {
                  return false;
                }
                return true;
              });
              resolve({ data, error: null });
            },
          };
          return chain;
        },
        update(patch: { priority_override?: boolean }) {
          return {
            in(_col: string, ids: string[]) {
              if (failUpdate) {
                return Promise.resolve({ error: { message: "write failed" } });
              }
              for (const row of store) {
                if (ids.includes(row.id) && patch.priority_override !== undefined) {
                  row.priority_override = patch.priority_override;
                }
              }
              if (disagreeAfterWrite && store[0]) {
                store[0].priority_override = !Boolean(patch.priority_override);
              }
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };

  return {
    client,
    store,
    failNextWrite() {
      failUpdate = true;
    },
    disagreeAfterWrite() {
      disagreeAfterWrite = true;
    },
  };
}

describe("PRIORITY-UX-002 selector Model A", () => {
  it("High owed bay is preferred over ordinary owed bay", () => {
    const ordinary = loc({ id: "o1", aisle: "10", bay: 1 });
    const high = loc({
      id: "h1",
      aisle: "41",
      bay: 1,
      priority_override: true,
    });
    const selected = selectPhysicalBayCoverage([ordinary, high], [], 1);
    expect(selected[0]?.key).toBe(physicalBayKey(high));
  });

  it("High COMPLETED bay is not re-admitted; ordinary owed remains eligible", () => {
    const ordinary = loc({ id: "o1", aisle: "10", bay: 1, status: "PENDING" });
    const completedHigh = loc({
      id: "h1",
      aisle: "41",
      bay: 1,
      status: "COMPLETED",
      priority_override: true,
    });
    expect(physicalBayIsOwed([completedHigh])).toBe(false);
    expect(isCarryOverDrawLocation(completedHigh)).toBe(false);
    expect(isManualHighPriorityLocation(completedHigh)).toBe(true);
    const selected = selectPhysicalBayCoverage(
      [ordinary],
      [completedHigh],
      1
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].key).toBe(physicalBayKey(ordinary));
  });

  it("multiple High COMPLETED bays cannot starve current-cycle ordinary coverage", () => {
    const ordinary = Array.from({ length: 6 }, (_, i) =>
      loc({ id: `o${i}`, aisle: "20", bay: i + 1 })
    );
    const completedHigh = Array.from({ length: 8 }, (_, i) =>
      loc({
        id: `h${i}`,
        aisle: "40",
        bay: i + 1,
        status: "COMPLETED",
        priority_override: true,
      })
    );
    const selected = selectPhysicalBayCoverage(ordinary, completedHigh, 3);
    expect(selected).toHaveLength(3);
    expect(selected.every((row) => row.key.includes("|20|"))).toBe(true);
  });

  it("durable High survives completion as a stored characteristic", () => {
    const high = loc({
      id: "h1",
      aisle: "41",
      bay: 2,
      status: "COMPLETED",
      priority_override: true,
    });
    expect(isManualHighPriorityLocation(high)).toBe(true);
    expect(physicalBayIsOwed([high])).toBe(false);
  });

  it("High becomes relevant again when the bay is eligible in a later cycle", () => {
    const nextCycleHigh = loc({
      id: "h1",
      aisle: "41",
      bay: 2,
      status: "PENDING",
      cycle_number: 2,
      priority_override: true,
    });
    const ordinary = loc({
      id: "o1",
      aisle: "10",
      bay: 1,
      status: "PENDING",
      cycle_number: 2,
    });
    const selected = selectPhysicalBayCoverage(
      [ordinary, nextCycleHigh],
      [],
      1
    );
    expect(selected[0]?.key).toBe(physicalBayKey(nextCycleHigh));
  });

  it("manual High and seasonal HIGH coexist without duplicating the physical bay", () => {
    const both = loc({
      id: "b1",
      aisle: "40",
      bay: 1,
      priority_override: true,
    });
    const ordinary = loc({ id: "o1", aisle: "10", bay: 1 });
    const key = physicalBayKey(both);
    const selected = selectPhysicalBayCoverage([ordinary, both], [], 1, {
      seasonalHighPhysicalKeys: [key],
    });
    expect(selected).toHaveLength(1);
    expect(selected[0].key).toBe(key);
  });

  it("priority does not change weekly quota", () => {
    expect(BASE_WEEKLY_BAY_QUOTA).toBe(3);
    expect(resolveAutomaticWeeklyBayTarget(4)).toBe(12);
    const pool = Array.from({ length: 20 }, (_, i) =>
      loc({
        id: `p${i}`,
        aisle: String(10 + Math.floor(i / 5)),
        bay: (i % 5) + 1,
        priority_override: i < 8,
      })
    );
    const selected = selectPhysicalBayCoverage(pool, [], 12);
    expect(selected).toHaveLength(12);
  });

  it("true carry-over still precedes High among owed bays", () => {
    const carry = loc({
      id: "c1",
      aisle: "11",
      bay: 1,
      status: "CARRIED_OVER",
      carried_over: true,
    });
    const high = loc({
      id: "h1",
      aisle: "41",
      bay: 1,
      priority_override: true,
    });
    const selected = selectPhysicalBayCoverage([high], [carry], 1);
    expect(selected[0]?.key).toBe(physicalBayKey(carry));
  });
});

describe("PRIORITY-UX-002 physical-bay mutation", () => {
  it("SELLING/TOPSTOCK siblings mutate together", async () => {
    const db = fakePriorityDb([
      {
        id: "s",
        aisle: "41",
        bay: 1,
        type: "SELLING",
        location_type: "STANDARD",
        is_active: true,
        priority_override: false,
        department_id: "dept-1",
      },
      {
        id: "t",
        aisle: "41",
        bay: 1,
        type: "TOPSTOCK",
        location_type: "STANDARD",
        is_active: true,
        priority_override: false,
        department_id: "dept-1",
      },
    ]);
    const result = await setPhysicalBayRotationPriority(db.client as never, {
      department_id: "dept-1",
      aisle: "41",
      bay: 1,
      priority: "high",
    });
    expect(result.surfaces_updated).toBe(2);
    expect(result.priority).toBe("high");
    expect(db.store.every((row) => row.priority_override === true)).toBe(true);
    expect(composePhysicalBayManualPriority(db.store)).toBe("high");
  });

  it("single-surface bay works", async () => {
    const db = fakePriorityDb([
      {
        id: "s",
        aisle: "12",
        bay: 4,
        type: "SELLING",
        location_type: "STANDARD",
        is_active: true,
        priority_override: true,
        department_id: "dept-1",
      },
    ]);
    const result = await setPhysicalBayRotationPriority(db.client as never, {
      department_id: "dept-1",
      aisle: "12",
      bay: 4,
      priority: "standard",
    });
    expect(result.surfaces_updated).toBe(1);
    expect(db.store[0]?.priority_override).toBe(false);
  });

  it("does not report success when sibling state disagrees after write", async () => {
    const db = fakePriorityDb([
      {
        id: "s",
        aisle: "41",
        bay: 2,
        type: "SELLING",
        location_type: "STANDARD",
        is_active: true,
        priority_override: false,
        department_id: "dept-1",
      },
      {
        id: "t",
        aisle: "41",
        bay: 2,
        type: "TOPSTOCK",
        location_type: "STANDARD",
        is_active: true,
        priority_override: false,
        department_id: "dept-1",
      },
    ]);
    db.disagreeAfterWrite();
    await expect(
      setPhysicalBayRotationPriority(db.client as never, {
        department_id: "dept-1",
        aisle: "41",
        bay: 2,
        priority: "high",
      })
    ).rejects.toThrow(/disagree/i);
  });

  it("does not report success when the write fails", async () => {
    const db = fakePriorityDb([
      {
        id: "s",
        aisle: "41",
        bay: 3,
        type: "SELLING",
        location_type: "STANDARD",
        is_active: true,
        priority_override: false,
        department_id: "dept-1",
      },
    ]);
    db.failNextWrite();
    await expect(
      setPhysicalBayRotationPriority(db.client as never, {
        department_id: "dept-1",
        aisle: "41",
        bay: 3,
        priority: "high",
      })
    ).rejects.toThrow(/write failed/i);
  });

  it("mixed aisle state is derived, not persisted", () => {
    const locations = [
      loc({ id: "a", aisle: "41", bay: 1, priority_override: true }),
      loc({
        id: "b",
        aisle: "41",
        bay: 1,
        type: "TOPSTOCK",
        priority_override: true,
      }),
      loc({ id: "c", aisle: "41", bay: 2, priority_override: false }),
    ];
    expect(composeAisleManualPriority(locations, "41")).toBe("mixed");
    expect(composePhysicalBayManualPriority([locations[0], locations[1]])).toBe(
      "high"
    );
    expect(composePhysicalBayManualPriority([locations[2]])).toBe("standard");
  });
});

describe("PRIORITY-UX-002 authorization", () => {
  it("Master and DS may mutate rotation priority; associates may not", () => {
    const master = member({ id: "m1", role: "MasterAdmin" });
    const ds = member({ id: "s1", role: "Supervisor" });
    const associate = member({ id: "a1", role: "Associate" });
    expect(isMasterAdmin(master)).toBe(true);
    expect(isDepartmentSupervisor(ds)).toBe(true);
    expect(isAssociate(associate)).toBe(true);
    expect(canMutateRotationPriority(master)).toBe(true);
    expect(canMutateRotationPriority(ds)).toBe(true);
    expect(canMutateRotationPriority(associate)).toBe(false);
  });

  it("priority permission is not topology mutation", () => {
    const rbac = readRepo("lib/rbac.ts");
    expect(rbac).toMatch(/canMutateRotationPriority/);
    expect(rbac).toMatch(/Does not grant topology mutation/);
    const ds = member({ id: "s1", role: "Supervisor" });
    expect(canMutateRotationPriority(ds)).toBe(true);
    expect(canMutateStoreMap(ds)).toBe(true);
    expect(readRepo("components/admin/StoreLocationGrid.tsx")).toMatch(
      /canMutate=\{false\}/
    );
    expect(readRepo("components/admin/StoreLocationGrid.tsx")).not.toMatch(
      /canMutate=\{true\}/
    );
  });

  it("physical-bay priority API is Supervisor+ and department-scoped", () => {
    const route = readRepo(
      "app/api/store-locations/physical-bay-priority/route.ts"
    );
    expect(route).toMatch(/requireSupervisorOrAdmin/);
    expect(route).toMatch(/assertActorCanAccessDepartmentId/);
    expect(route).not.toMatch(/requireSuperAdmin/);
    expect(route).not.toMatch(/associate/);
  });

  it("aisle priority API is also department-scoped", () => {
    const route = readRepo("app/api/store-locations/aisle-priority/route.ts");
    expect(route).toMatch(/requireSupervisorOrAdmin/);
    expect(route).toMatch(/assertActorCanAccessDepartmentId/);
  });

  it("Map topology PATCH remains Master-only for zone / map fields", () => {
    const route = readRepo("app/api/store-locations/route.ts");
    expect(route).toMatch(/Only Super Admin can edit zone \/ map fields/);
  });
});

describe("PRIORITY-UX-002 Map / More contracts", () => {
  it("Map exposes High/Standard without enabling topology mutation or pin-to-week", () => {
    const grid = readRepo("components/admin/StoreLocationGrid.tsx");
    const sheet = readRepo("components/admin/WalkTheFloorSheet.tsx");
    expect(grid).toMatch(/canMutateRotationPriority/);
    expect(grid).toMatch(/bay-high-priority-marker/);
    expect(grid).toMatch(/Mark aisle high priority/);
    expect(grid).toMatch(/Mixed priority/);
    expect(grid).toMatch(/canMutate=\{false\}/);
    expect(sheet).toMatch(/data-testid="map-bay-priority"/);
    expect(sheet).toMatch(/Mark high priority/);
    expect(sheet).toMatch(/canMutate && pinTargets\.length > 0/);
    expect(sheet).toMatch(/canMutateRotationPriority/);
    expect(grid).toMatch(/WalkTheFloorSheet[\s\S]*canMutate=\{false\}/);
  });

  it("Lock Priority Override and Hotspot leave Edit Bay; topology editing remains", () => {
    const edit = readRepo("components/admin/EditBayDrawer.tsx");
    const more = readRepo("components/admin/AisleBayManager.tsx");
    expect(edit).not.toMatch(/Lock Priority Override/);
    expect(edit).not.toMatch(/High-Velocity Hotspot/);
    expect(edit).not.toMatch(/Custom decay/);
    expect(edit).toMatch(/Bay workflow/);
    expect(edit).toMatch(/Save bay/);
    expect(edit).toMatch(/Delete bay/);
    expect(more).toMatch(/Edit/);
    expect(more).toMatch(/Delete/);
    expect(more).not.toMatch(/Mark aisle high priority/);
    expect(more).not.toMatch(/Lock Priority Override/);
  });

  it("Floor does not mutate durable priority", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).not.toMatch(/setPhysicalBayRotationPriority/);
    expect(floor).not.toMatch(/setAislePriority/);
    expect(floor).not.toMatch(/canMutateRotationPriority/);
  });

  it("priority mutation is online-only", () => {
    const client = readRepo("lib/store-ops/client.ts");
    const fn = client.slice(
      client.indexOf("export async function setPhysicalBayRotationPriority"),
      client.indexOf("export async function fetchOperationalContextsResolve")
    );
    expect(fn).toMatch(/physical-bay-priority/);
    expect(fn).not.toMatch(/enqueueOrExecute/);
  });

  it("selector load pool no longer treats override as carry", () => {
    const rotations = readRepo("lib/store-ops/rotations.ts");
    expect(rotations).not.toMatch(/priority_override\.eq\.true/);
    expect(rotations).toMatch(/Manual High is not loaded as carry/);
  });
});
