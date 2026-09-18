/**
 * ENGINE-PROD-003 — Manual extra-bay dispatch (+1).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  assessExtraBayBasePlan,
  BASE_WEEKLY_BAY_QUOTA,
  dispatchExtraPhysicalBay,
  selectNextExtraPhysicalBay,
} from "./extra-bay-dispatch";
import { physicalBayKey } from "./physical-bay";
import type { StoreLocation } from "./types";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
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
    velocity_tier: overrides.velocity_tier ?? "NORMAL",
    priority_override: overrides.priority_override ?? false,
    manual_priority_count: overrides.manual_priority_count ?? 0,
    carried_over: overrides.carried_over ?? false,
    last_completed_at: overrides.last_completed_at ?? null,
    last_serviced_at: overrides.last_serviced_at ?? null,
    created_at: overrides.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-01-01T00:00:00Z",
  } as StoreLocation;
}

describe("ENGINE-PROD-003 base quota preservation", () => {
  it("BASE_WEEKLY_BAY_QUOTA remains exactly 3", () => {
    expect(BASE_WEEKLY_BAY_QUOTA).toBe(3);
    const weekly = readRepo("lib/store-ops/weekly-rotations.ts");
    expect(weekly).toMatch(/export const BASE_WEEKLY_BAY_QUOTA = 3/);
  });

  it("extra-bay module does not mutate quota or invoke Sunday redistributor", () => {
    const src = readRepo("lib/store-ops/extra-bay-dispatch.ts");
    expect(src).toMatch(/selectPhysicalBayCoverage/);
    expect(src).toMatch(/assignLocationsToCurrentWeek/);
    expect(src).toMatch(/applySundayAssignmentPlanAdmin/);
    expect(src).not.toMatch(/planProportionalBayAssignments/);
    expect(src).not.toMatch(/planFlatBayAssignments/);
    expect(src).not.toMatch(/dispatchWeeklyPlanForDepartment/);
    expect(src).not.toMatch(/generateWeeklyRotations/);
    expect(src).not.toMatch(/BASE_WEEKLY_BAY_QUOTA\s*=/);
  });

  it("API route + UI expose Add another bay without Stage language in the action", () => {
    const route = readRepo("app/api/rotations/extra-bay/route.ts");
    const modal = readRepo("components/admin/SundayAuditAssignmentModal.tsx");
    expect(route).toMatch(/dispatchExtraPhysicalBay/);
    expect(modal).toMatch(/Add another bay/);
    expect(modal).toMatch(/suggestExtraBay/);
    expect(modal).toMatch(/dispatchExtraBay/);
    expect(modal).toMatch(/data-testid="extra-bay-dispatch"/);
  });
});

describe("ENGINE-PROD-003 selection reuse", () => {
  it("selects one owed physical bay and excludes already staged keys", () => {
    const pending = [
      loc({ id: "p1", aisle: "10", bay: 1, status: "PENDING" }),
      loc({
        id: "p1t",
        aisle: "10",
        bay: 1,
        type: "TOPSTOCK",
        status: "PENDING",
      }),
      loc({ id: "p2", aisle: "10", bay: 2, status: "PENDING" }),
      loc({
        id: "p2t",
        aisle: "10",
        bay: 2,
        type: "TOPSTOCK",
        status: "PENDING",
      }),
    ];
    const exclude = new Set([
      physicalBayKey({ department_id: "dept-1", aisle: "10", bay: 1 }),
    ]);
    const next = selectNextExtraPhysicalBay(pending, [], exclude);
    expect(next).not.toBeNull();
    expect(next!.key).toBe(
      physicalBayKey({ department_id: "dept-1", aisle: "10", bay: 2 })
    );
  });

  it("returns null when no owed physical bays remain", () => {
    const pending = [
      loc({ id: "p1", aisle: "10", bay: 1, status: "PENDING" }),
    ];
    const exclude = new Set([
      physicalBayKey({ department_id: "dept-1", aisle: "10", bay: 1 }),
    ]);
    expect(selectNextExtraPhysicalBay(pending, [], exclude)).toBeNull();
  });

  it("prefers carryover / priority_override via the shared selector", () => {
    const pending = [
      loc({ id: "n1", aisle: "20", bay: 1, status: "PENDING" }),
    ];
    const carried = [
      loc({
        id: "c1",
        aisle: "20",
        bay: 9,
        status: "CARRIED_OVER",
        carried_over: true,
        priority_override: true,
      }),
    ];
    const next = selectNextExtraPhysicalBay(pending, carried, []);
    expect(next?.key).toBe(
      physicalBayKey({ department_id: "dept-1", aisle: "20", bay: 9 })
    );
  });
});

describe("ENGINE-PROD-003 base plan assessment", () => {
  it("NO_BASE_PLAN when no rotations", () => {
    const result = assessExtraBayBasePlan({
      rotations: [],
      assignments: new Map(),
      specialistId: "a",
    });
    expect(result.ready).toBe(false);
    expect(result.status).toBe("NO_BASE_PLAN");
  });

  it("INCOMPLETE_BASE_PLAN when any rotation is unowned", () => {
    const assignments = new Map([
      [
        "r1",
        {
          bay_id: "r1",
          roster_specialist_id: "a",
          status: "assigned",
        },
      ],
    ]);
    const result = assessExtraBayBasePlan({
      rotations: [
        { id: "r1", location_id: "l1", assigned_week: "2026-W38" },
        { id: "r2", location_id: "l2", assigned_week: "2026-W38" },
      ],
      assignments,
      specialistId: "a",
    });
    expect(result.ready).toBe(false);
    expect(result.status).toBe("INCOMPLETE_BASE_PLAN");
    expect(result.unowned).toHaveLength(1);
  });

  it("ASSOCIATE_NOT_IN_PLAN when owner has fewer than base quota", () => {
    const assignments = new Map(
      Array.from({ length: 12 }, (_, i) => {
        const owner = i < 2 ? "a" : i < 5 ? "b" : i < 8 ? "c" : "d";
        return [
          `r${i}`,
          {
            bay_id: `r${i}`,
            roster_specialist_id: owner,
            status: "assigned",
          },
        ] as const;
      })
    );
    // Force a to only 2 by rebuilding
    const map = new Map([
      ...Array.from({ length: 2 }, (_, i) => [
        `ra${i}`,
        {
          bay_id: `ra${i}`,
          roster_specialist_id: "a",
          status: "assigned",
        },
      ]),
      ...Array.from({ length: 3 }, (_, i) => [
        `rb${i}`,
        {
          bay_id: `rb${i}`,
          roster_specialist_id: "b",
          status: "assigned",
        },
      ]),
    ] as Array<[string, { bay_id: string; roster_specialist_id: string; status: string }]>);
    const rotations = [...map.keys()].map((id) => ({
      id,
      location_id: id,
      assigned_week: "2026-W38",
    }));
    const result = assessExtraBayBasePlan({
      rotations,
      assignments: map,
      specialistId: "a",
    });
    expect(result.ready).toBe(false);
    expect(result.status).toBe("ASSOCIATE_NOT_IN_PLAN");
  });

  it("ready when all owned and target already has base quota", () => {
    const map = new Map(
      Array.from({ length: 12 }, (_, i) => {
        const owner =
          i < 3 ? "a" : i < 6 ? "b" : i < 9 ? "c" : "d";
        return [
          `r${i}`,
          {
            bay_id: `r${i}`,
            roster_specialist_id: owner,
            status: "assigned",
          },
        ] as const;
      })
    );
    const rotations = [...map.keys()].map((id) => ({
      id,
      location_id: id,
      assigned_week: "2026-W38",
    }));
    const result = assessExtraBayBasePlan({
      rotations,
      assignments: map,
      specialistId: "a",
    });
    expect(result.ready).toBe(true);
    expect(result.ownerCount).toBe(3);
  });
});

describe("ENGINE-PROD-003 dispatch orchestration (mocked writers)", () => {
  const assignMock = vi.fn();
  const ownMock = vi.fn();
  const poolsMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    assignMock.mockReset();
    ownMock.mockReset();
    poolsMock.mockReset();
  });

  it("happy path: stages one bay, owns it, does not touch other owners", async () => {
    vi.doMock("./rotations", async () => {
      const actual = await vi.importActual<typeof import("./rotations")>(
        "./rotations"
      );
      return {
        ...actual,
        assignLocationsToCurrentWeek: assignMock,
        loadOwedLocationPools: poolsMock,
      };
    });
    vi.doMock("./sunday-dispatch", async () => {
      const actual = await vi.importActual<
        typeof import("./sunday-dispatch")
      >("./sunday-dispatch");
      return {
        ...actual,
        applySundayAssignmentPlanAdmin: ownMock,
      };
    });

    const { dispatchExtraPhysicalBay: dispatch } = await import(
      "./extra-bay-dispatch"
    );

    const owned = new Map(
      Array.from({ length: 12 }, (_, i) => {
        const owner =
          i < 3 ? "alice" : i < 6 ? "bob" : i < 9 ? "cara" : "dana";
        return [
          `r${i}`,
          {
            bay_id: `r${i}`,
            roster_specialist_id: owner,
            status: "assigned",
          },
        ] as const;
      })
    );

    const rotations = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      location_id: `l${i}`,
      assigned_week: "2026-W38",
      store_locations: {
        id: `l${i}`,
        aisle: "10",
        bay: i + 1,
        department_id: "dept-1",
        type: "SELLING",
      },
    }));

    let assignmentState = new Map<
      string,
      { bay_id: string; roster_specialist_id: string; status: string }
    >(owned);
    let rotationState = [...rotations];

    assignMock.mockImplementation(async () => {
      const newRot = {
        id: "r-extra",
        location_id: "l-extra",
        assigned_week: "2026-W38",
      };
      rotationState = [...rotationState, newRot as (typeof rotations)[0]];
      return {
        assigned_week: "2026-W38",
        rotations: [newRot],
        locations: [],
      };
    });
    ownMock.mockImplementation(async (_sb: unknown, _week: string, items: Array<{ rotationId: string; specialist_id: string; specialist_name: string }>) => {
      for (const item of items) {
        assignmentState.set(String(item.rotationId), {
          bay_id: String(item.rotationId),
          roster_specialist_id: item.specialist_id,
          status: "assigned",
        });
      }
      return items.length;
    });
    poolsMock.mockResolvedValue({
      pending: [
        loc({
          id: "l-extra",
          aisle: "41",
          bay: 8,
          department_id: "dept-1",
          status: "PENDING",
        }),
      ],
      carried: [],
      cycleNumber: 1,
    });

    const supabase = {
      from(table: string) {
        if (table === "store_specialists") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "alice",
                    name: "Alice",
                    role: "Associate",
                    is_active: true,
                    home_department: "flooring",
                    assigned_department: "flooring",
                    store_number: "2587",
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "weekly_rotations") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  is: async () => ({
                    data: rotationState,
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "sunday_bay_assignments") {
          return {
            select: () => ({
              in: () => ({
                in: () => ({
                  eq: async () => ({
                    data: [...assignmentState.values()],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "store_locations") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: loc({
                      id: "l-extra",
                      aisle: "41",
                      bay: 8,
                      department_id: "dept-1",
                    }),
                    error: null,
                  }),
                }),
                maybeSingle: async () => ({
                  data: loc({
                    id: "l-extra",
                    aisle: "41",
                    bay: 8,
                    department_id: "dept-1",
                  }),
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const result = await dispatch(supabase as never, {
      department_id: "dept-1",
      department_code: "flooring",
      store_id: "store-1",
      store_number: "2587",
      specialist_id: "alice",
      specialist_name: "Alice",
      location_id: "l-extra",
      weekLabel: "2026-W38",
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.ok).toBe(true);
    expect(assignMock).toHaveBeenCalledTimes(1);
    expect(ownMock).toHaveBeenCalledTimes(1);
    expect(ownMock.mock.calls[0][2]).toEqual([
      {
        rotationId: "r-extra",
        specialist_id: "alice",
        specialist_name: "Alice",
      },
    ]);
    // Existing 12 ownership rows untouched by ownMock (only wrote the new one)
    expect(assignmentState.size).toBe(13);
    expect(
      [...assignmentState.values()].filter(
        (r) => r.roster_specialist_id === "bob"
      )
    ).toHaveLength(3);
    expect(
      [...assignmentState.values()].filter(
        (r) => r.roster_specialist_id === "cara"
      )
    ).toHaveLength(3);
    expect(
      [...assignmentState.values()].filter(
        (r) => r.roster_specialist_id === "dana"
      )
    ).toHaveLength(3);
    expect(
      [...assignmentState.values()].filter(
        (r) => r.roster_specialist_id === "alice"
      )
    ).toHaveLength(4);
  });

  it("retry with same location_id after stage+own is ALREADY_COMPLETE", async () => {
    vi.doMock("./rotations", async () => {
      const actual = await vi.importActual<typeof import("./rotations")>(
        "./rotations"
      );
      return {
        ...actual,
        assignLocationsToCurrentWeek: assignMock,
        loadOwedLocationPools: poolsMock,
      };
    });
    vi.doMock("./sunday-dispatch", async () => {
      const actual = await vi.importActual<
        typeof import("./sunday-dispatch")
      >("./sunday-dispatch");
      return {
        ...actual,
        applySundayAssignmentPlanAdmin: ownMock,
      };
    });

    const { dispatchExtraPhysicalBay: dispatch } = await import(
      "./extra-bay-dispatch"
    );

    const rotations = [
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `r${i}`,
        location_id: `l${i}`,
        assigned_week: "2026-W38",
        store_locations: {
          id: `l${i}`,
          aisle: "10",
          bay: i + 1,
          department_id: "dept-1",
          type: "SELLING",
        },
      })),
      {
        id: "r-extra",
        location_id: "l-extra",
        assigned_week: "2026-W38",
        store_locations: {
          id: "l-extra",
          aisle: "41",
          bay: 8,
          department_id: "dept-1",
          type: "SELLING",
        },
      },
    ];
    const assignments = new Map<
      string,
      { bay_id: string; roster_specialist_id: string; status: string }
    >(
      [
        ...Array.from({ length: 12 }, (_, i) => {
          const owner =
            i < 3 ? "alice" : i < 6 ? "bob" : i < 9 ? "cara" : "dana";
          return [
            `r${i}`,
            {
              bay_id: `r${i}`,
              roster_specialist_id: owner,
              status: "assigned",
            },
          ] as [string, { bay_id: string; roster_specialist_id: string; status: string }];
        }),
        [
          "r-extra",
          {
            bay_id: "r-extra",
            roster_specialist_id: "alice",
            status: "assigned",
          },
        ] as [string, { bay_id: string; roster_specialist_id: string; status: string }],
      ]
    );

    const supabase = {
      from(table: string) {
        if (table === "store_specialists") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "alice",
                    name: "Alice",
                    role: "Associate",
                    is_active: true,
                    home_department: "flooring",
                    store_number: "2587",
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "weekly_rotations") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  is: async () => ({ data: rotations, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "sunday_bay_assignments") {
          return {
            select: () => ({
              in: () => ({
                in: () => ({
                  eq: async () => ({
                    data: [...assignments.values()],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "store_locations") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: loc({
                      id: "l-extra",
                      aisle: "41",
                      bay: 8,
                      department_id: "dept-1",
                    }),
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const result = await dispatch(supabase as never, {
      department_id: "dept-1",
      department_code: "flooring",
      store_id: "store-1",
      store_number: "2587",
      specialist_id: "alice",
      location_id: "l-extra",
      weekLabel: "2026-W38",
    });

    expect(result.status).toBe("ALREADY_COMPLETE");
    expect(result.ok).toBe(true);
    expect(assignMock).not.toHaveBeenCalled();
    expect(ownMock).not.toHaveBeenCalled();
  });

  it("ownership writer failure after stage returns PARTIAL", async () => {
    vi.doMock("./rotations", async () => {
      const actual = await vi.importActual<typeof import("./rotations")>(
        "./rotations"
      );
      return {
        ...actual,
        assignLocationsToCurrentWeek: assignMock,
        loadOwedLocationPools: poolsMock,
      };
    });
    vi.doMock("./sunday-dispatch", async () => {
      const actual = await vi.importActual<
        typeof import("./sunday-dispatch")
      >("./sunday-dispatch");
      return {
        ...actual,
        applySundayAssignmentPlanAdmin: ownMock,
      };
    });

    const { dispatchExtraPhysicalBay: dispatch } = await import(
      "./extra-bay-dispatch"
    );

    const owned = new Map(
      Array.from({ length: 12 }, (_, i) => {
        const owner =
          i < 3 ? "alice" : i < 6 ? "bob" : i < 9 ? "cara" : "dana";
        return [
          `r${i}`,
          {
            bay_id: `r${i}`,
            roster_specialist_id: owner,
            status: "assigned",
          },
        ] as const;
      })
    );
    const rotations = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      location_id: `l${i}`,
      assigned_week: "2026-W38",
      store_locations: {
        id: `l${i}`,
        aisle: "10",
        bay: i + 1,
        department_id: "dept-1",
        type: "SELLING",
      },
    }));

    assignMock.mockResolvedValue({
      assigned_week: "2026-W38",
      rotations: [{ id: "r-extra", location_id: "l-extra" }],
      locations: [],
    });
    ownMock.mockRejectedValue(new Error("ownership write failed"));

    const supabase = {
      from(table: string) {
        if (table === "store_specialists") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "alice",
                    name: "Alice",
                    role: "Associate",
                    is_active: true,
                    home_department: "flooring",
                    store_number: "2587",
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "weekly_rotations") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  is: async () => ({ data: rotations, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "sunday_bay_assignments") {
          return {
            select: () => ({
              in: () => ({
                in: () => ({
                  eq: async () => ({
                    data: [...owned.values()],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "store_locations") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: loc({
                      id: "l-extra",
                      aisle: "41",
                      bay: 8,
                      department_id: "dept-1",
                    }),
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const result = await dispatch(supabase as never, {
      department_id: "dept-1",
      department_code: "flooring",
      store_id: "store-1",
      store_number: "2587",
      specialist_id: "alice",
      location_id: "l-extra",
      weekLabel: "2026-W38",
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.ok).toBe(false);
    expect(result.staged).toBe(true);
    expect(result.owned).toBe(false);
    expect(result.rotation_id).toBe("r-extra");
  });

  it("rejects MasterAdmin and inactive associates", async () => {
    const { dispatchExtraPhysicalBay: dispatch } = await import(
      "./extra-bay-dispatch"
    );
    const supabase = {
      from(table: string) {
        if (table === "store_specialists") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "boss",
                    name: "Boss",
                    role: "MasterAdmin",
                    is_active: true,
                    home_department: "flooring",
                    store_number: "2587",
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected ${table}`);
      },
    };
    const result = await dispatch(supabase as never, {
      department_id: "dept-1",
      department_code: "flooring",
      store_id: "store-1",
      store_number: "2587",
      specialist_id: "boss",
      weekLabel: "2026-W38",
    });
    expect(result.status).toBe("ASSOCIATE_NOT_ELIGIBLE");
    expect(result.ok).toBe(false);
  });
});

describe("ENGINE-PROD-003 regression source contracts", () => {
  it("does not invent seasonal / Gemini / Floor Pad / schema work", () => {
    const src = readRepo("lib/store-ops/extra-bay-dispatch.ts");
    expect(src).not.toMatch(/gemini|seasonal|floor.?pad|create table|rpc\(/i);
    expect(src).not.toMatch(/accessible_departments/);
    expect(src).not.toMatch(/localStorage/);
  });

  it("no migration added for extra bay", () => {
    const migrations = fs.readdirSync(
      path.join(root, "supabase/migrations")
    );
    expect(migrations.some((f) => /extra.?bay/i.test(f))).toBe(false);
  });
});
