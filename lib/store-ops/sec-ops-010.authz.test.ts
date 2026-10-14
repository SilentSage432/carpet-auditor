/**
 * DEPTSYNC-SEC-OPS-010 — operational authority negative security tests.
 *
 * Isolated / mocked only. No production credentials. No destructive mutations.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  requireStoreOpsActor,
  requireSuperAdmin,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
  type StoreOpsActor,
} from "./auth";
import { reportRotationBarriers } from "./verification";
import { STRICT_SECTION_OWNERSHIP_AUTO_STAGE } from "./section-ownership-enforcement";
import { confirmSundayBayZebraEntry } from "./zebra-handoff";

const root = join(__dirname, "../..");

function readRoute(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function actor(partial: Partial<StoreOpsActor> & Pick<StoreOpsActor, "role">): StoreOpsActor {
  return {
    userId: partial.userId ?? "user-1",
    specialistId: partial.specialistId ?? "spec-1",
    role: partial.role,
    departmentCode: partial.departmentCode ?? "flooring",
    accessibleDepartmentCodes: partial.accessibleDepartmentCodes ?? ["flooring"],
    storeNumber: partial.storeNumber ?? "2587",
  };
}

describe("SEC-OPS-010 — role helpers (forged role / unauthenticated)", () => {
  it("rejects unauthenticated mutation helpers", () => {
    expect(() => requireStoreOpsActor(null)).toThrow(StoreOpsAuthError);
    try {
      requireStoreOpsActor(null);
    } catch (err) {
      expect((err as StoreOpsAuthError).status).toBe(401);
    }
  });

  it("rejects associate performing supervisor actions", () => {
    const associate = actor({ role: "associate" });
    expect(() => requireSupervisorOrAdmin(associate)).toThrow(StoreOpsAuthError);
    try {
      requireSupervisorOrAdmin(associate);
    } catch (err) {
      expect((err as StoreOpsAuthError).status).toBe(403);
    }
  });

  it("rejects supervisor for MasterAdmin-only capacity approval helper", () => {
    expect(() =>
      requireSuperAdmin(actor({ role: "department_supervisor" }))
    ).toThrow(StoreOpsAuthError);
  });

  it("accepts supervisor and MasterAdmin for supervisor gates", () => {
    expect(requireSupervisorOrAdmin(actor({ role: "department_supervisor" })).role).toBe(
      "department_supervisor"
    );
    expect(requireSupervisorOrAdmin(actor({ role: "super_admin" })).role).toBe(
      "super_admin"
    );
  });
});

describe("SEC-OPS-010 — route server enforcement contracts", () => {
  it("rotation assign requires department scope + store-bound locations", () => {
    const src = readRoute("app/api/rotations/assign/route.ts");
    expect(src).toContain("requireSupervisorOrAdmin");
    expect(src).toContain("assertActorCanAccessDepartmentId");
    expect(src).toContain('eq("store_id", store.id)');
    expect(src).toContain('eq("department_id", departmentId)');
    expect(src).toContain("outside your store department scope");
  });

  it("extra-bay requires department scope", () => {
    const src = readRoute("app/api/rotations/extra-bay/route.ts");
    expect(src).toContain("requireSupervisorOrAdmin");
    expect(src).toContain("assertActorCanAccessDepartmentId");
  });

  it("bulk topology rejects forged client store_id", () => {
    const src = readRoute("app/api/store-locations/bulk/route.ts");
    expect(src).toContain("requireSuperAdmin");
    expect(src).toContain("store_id does not match authenticated store");
    expect(src).toContain('.eq("store_id", store.id)');
    expect(src).not.toMatch(/body\.store_id\?\.trim\(\)\s*\|\|\s*store\.id/);
  });

  it("complete and verify bind rotation to actor store", () => {
    const complete = readRoute("app/api/rotations/complete/route.ts");
    const verify = readRoute("app/api/rotations/verify/route.ts");
    expect(complete).toContain("Rotation is outside your store");
    expect(complete).toContain("store_id, store_number");
    expect(verify).toContain("Rotation is outside your store");
    expect(verify).toContain("store_id, store_number, department_id");
  });

  it("barrier exceptions pass storeId into domain", () => {
    const src = readRoute("app/api/rotations/exceptions/route.ts");
    expect(src).toContain("storeId: store.id");
    expect(src).toContain("requireStoreOpsActor");
  });

  it("week bay priority revoke asserts department from target row", () => {
    const src = readRoute("app/api/store-locations/week-bay-priority/route.ts");
    expect(src).toContain("requireSupervisorOrAdmin");
    expect(src).toContain("assertActorCanAccessDepartmentId");
    expect(src).toContain("priority_id");
    expect(src).toContain("department_id is required when priority_id is not supplied");
    expect(src).toContain("actorAllowsDepartmentCode");
  });

  it("section owner writes validate roster store membership", () => {
    const create = readRoute("app/api/operational-sections/route.ts");
    const patch = readRoute("app/api/operational-sections/[id]/route.ts");
    expect(create).toContain("assertRosterSpecialistForStore");
    expect(patch).toContain("assertRosterSpecialistForStore");
  });

  it("zebra handoff requires supervisor and does not claim Zebra completion", () => {
    const src = readRoute("app/api/rotations/zebra-entry/route.ts");
    expect(src).toContain("requireSupervisorOrAdmin");
    expect(src).toContain("manual_operator_record");
    expect(src).toContain("not proof of Zebra acceptance");
  });

  it("walkthrough mutations use server actor store + supervisor create", () => {
    const obs = readRoute("app/api/walkthroughs/observations/route.ts");
    const follow = readRoute("app/api/walkthroughs/follow-ups/[id]/route.ts");
    expect(obs).toContain("requireSupervisorOrAdmin");
    expect(obs).toContain("assertActorCanAccessDepartmentId");
    expect(obs).toContain("created_by_specialist_id: actor.specialistId");
    expect(follow).toContain("completed_by_specialist_id: actor.specialistId");
  });

  it("auth headers are not trusted for actor resolution", () => {
    const auth = readRoute("lib/store-ops/auth.ts");
    expect(auth).toContain("parseStoreOpsActor(_request: Request): StoreOpsActor | null");
    expect(auth).toMatch(/return null/);
  });
});

describe("SEC-OPS-010 — barrier cross-store / cross-section rejection", () => {
  function mockBarrierDb(opts: {
    locations: Array<{
      id: string;
      store_id: string;
      department_id: string;
    }>;
    rotations?: Array<{
      id: string;
      store_id: string;
      department_id: string;
      location_id: string;
    }>;
  }) {
    const inserts: Array<{ table: string; rows: Record<string, unknown>[] }> = [];
    return {
      inserts,
      client: {
        from(table: string) {
          const state: {
            ids?: string[];
            op: "select" | "insert" | "update";
            rows?: Record<string, unknown>[];
          } = { op: "select" };
          const api: Record<string, unknown> = {};
          const self = () => api;
          api.select = self;
          api.update = () => {
            state.op = "update";
            return api;
          };
          api.insert = (
            rows: Record<string, unknown>[] | Record<string, unknown>
          ) => {
            state.op = "insert";
            state.rows = Array.isArray(rows) ? rows : [rows];
            inserts.push({ table, rows: state.rows });
            return api;
          };
          api.in = (col: string, vals: unknown[]) => {
            if (col === "id") state.ids = vals.map(String);
            return api;
          };
          api.eq = self;
          api.maybeSingle = async () => ({ data: null, error: null });
          api.then = (
            resolve: (v: { data: unknown; error: null }) => unknown,
            reject?: (e: unknown) => unknown
          ) => {
            try {
              if (state.op === "insert") {
                return Promise.resolve(
                  resolve({ data: state.rows ?? [], error: null })
                );
              }
              if (table === "store_locations") {
                const data = opts.locations.filter((l) =>
                  (state.ids ?? []).includes(l.id)
                );
                return Promise.resolve(resolve({ data, error: null }));
              }
              if (table === "weekly_rotations") {
                const data = (opts.rotations ?? []).filter((r) =>
                  (state.ids ?? []).includes(r.id)
                );
                return Promise.resolve(resolve({ data, error: null }));
              }
              return Promise.resolve(resolve({ data: [], error: null }));
            } catch (e) {
              return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
            }
          };
          return api;
        },
      },
    };
  }

  it("rejects cross-store location barrier when storeId is enforced", async () => {
    const db = mockBarrierDb({
      locations: [
        { id: "loc-x", store_id: "store-OTHER", department_id: "dept-1" },
      ],
    });
    await expect(
      reportRotationBarriers(db.client as never, {
        departmentId: "dept-1",
        storeId: "store-2587",
        assignedWeek: "2026-W42",
        reportedBy: "spec-1",
        incomplete: [
          {
            rotationId: "",
            locationId: "loc-x",
            reason: "Blocked Bay",
            cycleNumber: 1,
          },
        ],
      })
    ).rejects.toThrow(/outside your store department scope/);
    expect(db.inserts).toHaveLength(0);
  });

  it("rejects cross-department location barrier when storeId is enforced", async () => {
    const db = mockBarrierDb({
      locations: [
        { id: "loc-1", store_id: "store-2587", department_id: "dept-OTHER" },
      ],
    });
    await expect(
      reportRotationBarriers(db.client as never, {
        departmentId: "dept-1",
        storeId: "store-2587",
        assignedWeek: "2026-W42",
        incomplete: [
          {
            rotationId: "",
            locationId: "loc-1",
            reason: "Blocked Bay",
            cycleNumber: 1,
          },
        ],
      })
    ).rejects.toThrow(/outside your store department scope/);
  });
});

describe("SEC-OPS-010 — zebra attribution integrity", () => {
  it("rejects associate zebra confirm at domain boundary", async () => {
    await expect(
      confirmSundayBayZebraEntry(
        {
          from() {
            throw new Error("should not query");
          },
        } as never,
        actor({ role: "associate" }),
        {
          storeNumber: "2587",
          weekLabel: "2026-W42",
          bayId: "bay-1",
        }
      )
    ).rejects.toThrow(StoreOpsAuthError);
  });

  it("rejects forged store on zebra confirm", async () => {
    await expect(
      confirmSundayBayZebraEntry(
        {
          from() {
            throw new Error("should not query");
          },
        } as never,
        actor({ role: "department_supervisor", storeNumber: "2587" }),
        {
          storeNumber: "9999",
          weekLabel: "2026-W42",
          bayId: "bay-1",
        }
      )
    ).rejects.toThrow(/Store is outside your access/);
  });

  it("does not overwrite existing zebra evidence (idempotent)", async () => {
    const existing = {
      id: "asg-1",
      store_number: "2587",
      department: "flooring",
      week_starting: "2026-10-12",
      bay_id: "bay-1",
      roster_specialist_id: "assoc-1",
      specialist_name: "A",
      status: "assigned",
      zebra_entered_at: "2026-10-12T12:00:00.000Z",
      zebra_entered_by: "original-operator",
    };
    let updateCalled = false;
    const result = await confirmSundayBayZebraEntry(
      {
        from() {
          const api = {
            select() {
              return api;
            },
            update() {
              updateCalled = true;
              return api;
            },
            in() {
              return api;
            },
            eq() {
              return api;
            },
            neq() {
              return api;
            },
            limit() {
              return api;
            },
            maybeSingle: async () => ({ data: existing, error: null }),
            then(
              resolve: (v: { data: unknown; error: null }) => unknown
            ) {
              return Promise.resolve(resolve({ data: [existing], error: null }));
            },
          };
          return api;
        },
      } as never,
      actor({ role: "department_supervisor", specialistId: "forged-actor" }),
      {
        storeNumber: "2587",
        weekLabel: "2026-W42",
        bayId: "bay-1",
        departmentCode: "flooring",
      }
    );
    expect(updateCalled).toBe(false);
    expect(result.already_confirmed).toBe(true);
    expect(result.zebra_entered_by).toBe("original-operator");
    expect(result.zebra_entered_at).toBe("2026-10-12T12:00:00.000Z");
  });
});

describe("SEC-OPS-010 — preserved operational invariants", () => {
  it("Sunday auto-stage remains OFF", () => {
    expect(STRICT_SECTION_OWNERSHIP_AUTO_STAGE).toBe(false);
  });
});
