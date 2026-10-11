/**
 * DEPTSYNC-CLEANUP-002 — soft mutation safety (mocked Supabase).
 */

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  archiveCleanupAssociates,
  retireCleanupAisles,
  aisleSelectionFingerprint,
  associateSelectionFingerprint,
} from "./workspace-cleanup";

type Loc = {
  id: string;
  department_id: string;
  aisle: string;
  bay: number;
  type: string;
  is_active: boolean;
  store_id: string;
};

type Spec = {
  id: string;
  name: string;
  role: string;
  assigned_department: string | null;
  home_department: string | null;
  floor_title: string | null;
  is_active: boolean;
  status: string;
  store_number: string;
};

function createMockSupabase(state: {
  locations: Loc[];
  specialists: Spec[];
  deletedCalls?: Array<Record<string, unknown>>;
}) {
  const updates: Array<{ table: string; patch: Record<string, unknown>; ids?: string[] }> =
    [];
  const deletedCalls = state.deletedCalls ?? [];

  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let op: "select" | "update" | "delete" = "select";
      let patch: Record<string, unknown> | null = null;
      let inIds: string[] | null = null;

      const api = {
        select() {
          op = "select";
          return api;
        },
        update(next: Record<string, unknown>) {
          op = "update";
          patch = next;
          return api;
        },
        delete() {
          op = "delete";
          deletedCalls.push({ table, filters: { ...filters } });
          return api;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return api;
        },
        neq(col: string, val: unknown) {
          filters[`neq:${col}`] = val;
          return api;
        },
        in(col: string, vals: string[]) {
          filters[`in:${col}`] = vals;
          inIds = vals;
          return api;
        },
        order() {
          return api;
        },
        then(resolve: (v: unknown) => unknown) {
          if (table === "store_locations") {
            if (op === "update") {
              const storeId = String(filters.store_id ?? "");
              const ids = (filters["in:id"] as string[]) ?? inIds ?? [];
              for (const loc of state.locations) {
                if (loc.store_id !== storeId) continue;
                if (ids.length && !ids.includes(loc.id)) continue;
                Object.assign(loc, patch);
              }
              updates.push({ table, patch: patch ?? {}, ids });
              return Promise.resolve(resolve({ data: null, error: null }));
            }
            let rows = state.locations.filter((l) => {
              if (filters.store_id && l.store_id !== filters.store_id) {
                return false;
              }
              const deptIn = filters["in:department_id"] as string[] | undefined;
              if (deptIn && !deptIn.includes(l.department_id)) return false;
              return true;
            });
            return Promise.resolve(resolve({ data: rows, error: null }));
          }

          if (table === "store_specialists") {
            if (op === "update") {
              const storeNumber = String(filters.store_number ?? "");
              const id = String(filters.id ?? "");
              const ids = (filters["in:id"] as string[]) ?? [];
              const neqRole = filters["neq:role"];
              for (const row of state.specialists) {
                if (row.store_number !== storeNumber) continue;
                if (id && row.id !== id) continue;
                if (ids.length && !ids.includes(row.id)) continue;
                if (neqRole && row.role === neqRole) continue;
                Object.assign(row, patch);
              }
              updates.push({
                table,
                patch: patch ?? {},
                ids: id ? [id] : ids,
              });
              return Promise.resolve(resolve({ data: null, error: null }));
            }
            let rows = state.specialists.filter((s) => {
              if (
                filters.store_number &&
                s.store_number !== filters.store_number
              ) {
                return false;
              }
              const idIn = filters["in:id"] as string[] | undefined;
              if (idIn && !idIn.includes(s.id)) return false;
              return true;
            });
            return Promise.resolve(resolve({ data: rows, error: null }));
          }

          // History tables used by preview — empty is fine for mutation tests.
          return Promise.resolve(resolve({ data: [], error: null }));
        },
      };
      return api;
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    updates,
    deletedCalls,
  };
}

describe("retireCleanupAisles", () => {
  it("soft-retires matching surfaces and is idempotent", async () => {
    const locations: Loc[] = [
      {
        id: "l1",
        department_id: "d1",
        aisle: "12",
        bay: 1,
        type: "SELLING",
        is_active: true,
        store_id: "store-1",
      },
      {
        id: "l2",
        department_id: "d1",
        aisle: "12",
        bay: 1,
        type: "TOPSTOCK",
        is_active: true,
        store_id: "store-1",
      },
    ];
    const state = {
      locations,
      specialists: [] as Spec[],
    };
    const { client, updates, deletedCalls } = createMockSupabase(state);
    const fingerprint = aisleSelectionFingerprint([
      {
        department_id: "d1",
        aisle: "12",
        active_location_ids: ["l1", "l2"],
      },
    ]);

    const first = await retireCleanupAisles(client, {
      storeId: "store-1",
      keys: [{ department_id: "d1", aisle: "12" }],
      fingerprint,
    });
    expect(first.ok).toBe(true);
    expect(first.results[0]?.status).toBe("retired");
    expect(locations.every((l) => !l.is_active)).toBe(true);
    expect(updates.every((u) => u.patch.is_active === false)).toBe(true);
    expect(deletedCalls).toHaveLength(0);

    const second = await retireCleanupAisles(client, {
      storeId: "store-1",
      keys: [{ department_id: "d1", aisle: "12" }],
      fingerprint: aisleSelectionFingerprint([
        {
          department_id: "d1",
          aisle: "12",
          active_location_ids: [],
        },
      ]),
    });
    expect(second.results[0]?.status).toBe("already_retired");
    expect(deletedCalls).toEqual([]);
  });

  it("fails safely on stale fingerprint without mutating", async () => {
    const state = {
      locations: [
        {
          id: "l1",
          department_id: "d1",
          aisle: "12",
          bay: 1,
          type: "SELLING",
          is_active: true,
          store_id: "store-1",
        },
      ] satisfies Loc[],
      specialists: [] as Spec[],
    };
    const { client, updates } = createMockSupabase(state);
    const outcome = await retireCleanupAisles(client, {
      storeId: "store-1",
      keys: [{ department_id: "d1", aisle: "12" }],
      fingerprint: "stale",
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.results[0]?.status).toBe("review");
    expect(state.locations[0]?.is_active).toBe(true);
    expect(updates).toEqual([]);
  });

  it("does not retire locations from another store", async () => {
    const state = {
      locations: [
        {
          id: "other",
          department_id: "d1",
          aisle: "12",
          bay: 1,
          type: "SELLING",
          is_active: true,
          store_id: "store-OTHER",
        },
      ] satisfies Loc[],
      specialists: [] as Spec[],
    };
    const { client } = createMockSupabase(state);
    const fingerprint = aisleSelectionFingerprint([
      {
        department_id: "d1",
        aisle: "12",
        active_location_ids: [],
      },
    ]);
    const outcome = await retireCleanupAisles(client, {
      storeId: "store-1",
      keys: [{ department_id: "d1", aisle: "12" }],
      fingerprint,
    });
    expect(outcome.results[0]?.status).toBe("review");
    expect(state.locations[0]?.is_active).toBe(true);
  });
});

describe("archiveCleanupAssociates", () => {
  it("soft-archives and never hard-deletes; rejects MasterAdmin", async () => {
    const state = {
      locations: [] as Loc[],
      specialists: [
        {
          id: "a1",
          name: "Alex",
          role: "Associate",
          assigned_department: "flooring",
          home_department: null,
          floor_title: "Specialist",
          is_active: true,
          status: "active",
          store_number: "2587",
        },
        {
          id: "m1",
          name: "Operator",
          role: "MasterAdmin",
          assigned_department: "flooring",
          home_department: null,
          floor_title: null,
          is_active: true,
          status: "active",
          store_number: "2587",
        },
      ] satisfies Spec[],
    };
    const deletedCalls: Array<Record<string, unknown>> = [];
    const { client } = createMockSupabase({ ...state, deletedCalls });

    const blocked = await archiveCleanupAssociates(client, {
      storeNumber: "2587",
      specialistIds: ["m1"],
      fingerprint: "x",
    });
    expect("error" in blocked).toBe(true);
    if ("error" in blocked) {
      expect(blocked.status).toBe(403);
    }

    const fingerprint = associateSelectionFingerprint([
      { id: "a1", is_active: true, status: "active" },
    ]);
    const outcome = await archiveCleanupAssociates(client, {
      storeNumber: "2587",
      specialistIds: ["a1"],
      fingerprint,
    });
    expect("error" in outcome).toBe(false);
    if (!("error" in outcome)) {
      expect(outcome.ok).toBe(true);
      expect(outcome.results[0]?.status).toBe("archived");
    }
    expect(state.specialists[0]?.is_active).toBe(false);
    expect(state.specialists[0]?.status).toBe("suspended");
    expect(state.specialists[1]?.is_active).toBe(true);
    expect(deletedCalls).toEqual([]);

    const retry = await archiveCleanupAssociates(client, {
      storeNumber: "2587",
      specialistIds: ["a1"],
      fingerprint: associateSelectionFingerprint([
        { id: "a1", is_active: false, status: "suspended" },
      ]),
    });
    if (!("error" in retry)) {
      expect(retry.results[0]?.status).toBe("already_archived");
    }
  });

  it("rejects associates outside store scope", async () => {
    const state = {
      locations: [] as Loc[],
      specialists: [
        {
          id: "a1",
          name: "Alex",
          role: "Associate",
          assigned_department: "flooring",
          home_department: null,
          floor_title: null,
          is_active: true,
          status: "active",
          store_number: "9999",
        },
      ] satisfies Spec[],
    };
    const { client } = createMockSupabase(state);
    const result = await archiveCleanupAssociates(client, {
      storeNumber: "2587",
      specialistIds: ["a1"],
      fingerprint: "x",
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.status).toBe(404);
    }
    expect(state.specialists[0]?.is_active).toBe(true);
  });
});
