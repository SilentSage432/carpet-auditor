/**
 * FS-002 operational context tests — synthetic fixtures only.
 */

import { describe, expect, it } from "vitest";
import { createFakeOperationalContextDb } from "./operational-context.fake";
import {
  createMasterDeclaredOperationalContext,
  deleteMasterDeclaredOperationalContext,
  resolveOperationalContextsForDate,
  resolveOperationalContextsFromRows,
  setOperationalContextDepartmentRelevance,
  validateMasterDeclaredContextInput,
  type OperationalContext,
  type OperationalContextDepartmentRelevance,
} from "./operational-context";
import {
  requireStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
  type StoreOpsActor,
} from "./auth";

function ctx(
  partial: Partial<OperationalContext> &
    Pick<OperationalContext, "id" | "kind" | "title" | "start_date" | "end_date">
): OperationalContext {
  return {
    store_id: partial.store_id ?? "store-2587",
    concept_key: partial.concept_key ?? null,
    source_type: partial.source_type ?? "MASTER_ADMIN_DECLARED",
    source_reference: partial.source_reference ?? null,
    source_year: partial.source_year ?? null,
    declared_by: partial.declared_by ?? "master-user",
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
    ...partial,
  };
}

describe("FS-002 operational context resolution", () => {
  it("1. season active on date", () => {
    const season = ctx({
      id: "s1",
      kind: "SEASON",
      title: "Late Summer",
      start_date: "2026-08-01",
      end_date: "2026-09-30",
    });
    const result = resolveOperationalContextsFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts: [season],
      relevance: [],
    });
    expect(result.active_seasons).toHaveLength(1);
    expect(result.active_seasons[0]!.title).toBe("Late Summer");
    expect(result.active_events).toHaveLength(0);
  });

  it("2. event active on date", () => {
    const event = ctx({
      id: "e1",
      kind: "EVENT",
      title: "Inventory Prep",
      start_date: "2026-09-01",
      end_date: "2026-09-10",
    });
    const result = resolveOperationalContextsFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts: [event],
      relevance: [],
    });
    expect(result.active_events).toHaveLength(1);
  });

  it("3. multiple overlapping contexts", () => {
    const contexts = [
      ctx({
        id: "s1",
        kind: "SEASON",
        title: "Late Summer",
        start_date: "2026-08-01",
        end_date: "2026-09-30",
      }),
      ctx({
        id: "e1",
        kind: "EVENT",
        title: "Inventory Prep",
        start_date: "2026-09-01",
        end_date: "2026-09-10",
      }),
      ctx({
        id: "e2",
        kind: "EVENT",
        title: "Promo Push",
        start_date: "2026-09-04",
        end_date: "2026-09-06",
      }),
    ];
    const result = resolveOperationalContextsFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts,
      relevance: [],
    });
    expect(result.active_seasons).toHaveLength(1);
    expect(result.active_events).toHaveLength(2);
    expect(result.active_events.map((e) => e.title)).toEqual([
      "Inventory Prep",
      "Promo Push",
    ]);
  });

  it("4. no active context", () => {
    const result = resolveOperationalContextsFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts: [
        ctx({
          id: "s1",
          kind: "SEASON",
          title: "Spring",
          start_date: "2026-03-01",
          end_date: "2026-05-31",
        }),
      ],
      relevance: [],
    });
    expect(result.active_seasons).toHaveLength(0);
    expect(result.active_events).toHaveLength(0);
  });

  it("5. season crossing fiscal period/quarter still resolves by Gregorian dates", () => {
    // FY2026 P7 ends ~2026-08-28; P8 starts 2026-08-29 — season spans both.
    const season = ctx({
      id: "s1",
      kind: "SEASON",
      title: "Late Summer Transition",
      start_date: "2026-08-15",
      end_date: "2026-09-15",
    });
    const a = resolveOperationalContextsFromRows({
      operationalDate: "2026-08-20",
      storeId: "store-2587",
      contexts: [season],
      relevance: [],
    });
    const b = resolveOperationalContextsFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts: [season],
      relevance: [],
    });
    expect(a.active_seasons).toHaveLength(1);
    expect(b.active_seasons).toHaveLength(1);
  });

  it("6. context crossing fiscal-year boundary", () => {
    const season = ctx({
      id: "s1",
      kind: "SEASON",
      title: "Year Turn",
      start_date: "2027-01-20",
      end_date: "2027-02-10",
    });
    const result = resolveOperationalContextsFromRows({
      operationalDate: "2027-01-29",
      storeId: "store-2587",
      contexts: [season],
      relevance: [],
    });
    expect(result.active_seasons).toHaveLength(1);
  });

  it("7. date outside fiscal calendar still resolves Gregorian context", () => {
    // After FY2026 end (2027-01-29)
    const event = ctx({
      id: "e1",
      kind: "EVENT",
      title: "Post-FY Prep",
      start_date: "2027-02-01",
      end_date: "2027-02-14",
    });
    const result = resolveOperationalContextsFromRows({
      operationalDate: "2027-02-05",
      storeId: "store-2587",
      contexts: [event],
      relevance: [],
    });
    expect(result.active_events).toHaveLength(1);
  });

  it("8–10. store declaration; global + store coexist; other-store excluded", () => {
    const contexts = [
      ctx({
        id: "g1",
        kind: "EVENT",
        title: "Global Holiday Marker",
        start_date: "2026-09-01",
        end_date: "2026-09-07",
        store_id: null,
        source_type: "PUBLIC_CALENDAR",
        declared_by: null,
      }),
      ctx({
        id: "s2587",
        kind: "SEASON",
        title: "Store Late Summer",
        start_date: "2026-08-01",
        end_date: "2026-09-30",
        store_id: "store-2587",
      }),
      ctx({
        id: "s9999",
        kind: "SEASON",
        title: "Other Store Season",
        start_date: "2026-08-01",
        end_date: "2026-09-30",
        store_id: "store-9999",
      }),
    ];
    const result = resolveOperationalContextsFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts,
      relevance: [],
    });
    expect(result.active_seasons.map((s) => s.id)).toEqual(["s2587"]);
    expect(result.active_events.map((e) => e.id)).toEqual(["g1"]);
  });

  it("11–13. department relevance HIGH / NONE / UNSET", () => {
    const season = ctx({
      id: "s1",
      kind: "SEASON",
      title: "Late Summer",
      start_date: "2026-08-01",
      end_date: "2026-09-30",
    });
    const relevance: OperationalContextDepartmentRelevance[] = [
      {
        id: "r1",
        context_id: "s1",
        department_code: "flooring",
        relevance: "HIGH",
        created_at: "2026-09-05T00:00:00.000Z",
        updated_at: "2026-09-05T00:00:00.000Z",
      },
      {
        id: "r2",
        context_id: "s1",
        department_code: "appliances",
        relevance: "NONE",
        created_at: "2026-09-05T00:00:00.000Z",
        updated_at: "2026-09-05T00:00:00.000Z",
      },
    ];
    const flooring = resolveOperationalContextsFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      departmentCode: "flooring",
      contexts: [season],
      relevance,
    });
    expect(flooring.active_seasons[0]!.department_relevance).toBe("HIGH");

    const appliances = resolveOperationalContextsFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      departmentCode: "appliances",
      contexts: [season],
      relevance,
    });
    expect(appliances.active_seasons[0]!.department_relevance).toBe("NONE");

    const paint = resolveOperationalContextsFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      departmentCode: "D24P",
      contexts: [season],
      relevance,
    });
    expect(paint.active_seasons[0]!.department_relevance).toBeNull();
  });

  it("14. overlapping custom declarations allowed", () => {
    const contexts = [
      ctx({
        id: "a",
        kind: "EVENT",
        title: "Prep A",
        start_date: "2026-09-01",
        end_date: "2026-09-10",
      }),
      ctx({
        id: "b",
        kind: "EVENT",
        title: "Prep B",
        start_date: "2026-09-05",
        end_date: "2026-09-12",
      }),
    ];
    const result = resolveOperationalContextsFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts,
      relevance: [],
    });
    expect(result.active_events).toHaveLength(2);
  });

  it("15–17. invalid date range / kind / source rejected at validation", () => {
    expect(
      validateMasterDeclaredContextInput({
        kind: "SEASON",
        title: "X",
        start_date: "2026-09-10",
        end_date: "2026-09-01",
      }).some((i) => i.code === "date_order")
    ).toBe(true);

    expect(
      validateMasterDeclaredContextInput({
        kind: "SEASON" as const,
        title: "",
        start_date: "2026-09-01",
        end_date: "2026-09-10",
      }).some((i) => i.code === "title_required")
    ).toBe(true);

    // Runtime create always stamps MASTER_ADMIN_DECLARED — invalid kinds caught:
    expect(
      validateMasterDeclaredContextInput({
        kind: "NOT_A_KIND" as never,
        title: "X",
        start_date: "2026-09-01",
        end_date: "2026-09-10",
      }).some((i) => i.code === "invalid_kind")
    ).toBe(true);
  });

  it("18. Master-declared provenance assigned server-side on create", async () => {
    const db = createFakeOperationalContextDb();
    const result = await createMasterDeclaredOperationalContext(db.client, {
      kind: "SEASON",
      title: "Late Summer Transition",
      start_date: "2026-08-01",
      end_date: "2026-09-30",
      store_id: "store-2587",
      declared_by: "profile-master-uuid",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.source_type).toBe("MASTER_ADMIN_DECLARED");
    expect(result.context.declared_by).toBe("profile-master-uuid");
    expect(result.context.store_id).toBe("store-2587");
  });
});

describe("FS-002 mutation domain", () => {
  it("set relevance HIGH then clear to UNSET", async () => {
    const db = createFakeOperationalContextDb();
    const created = await createMasterDeclaredOperationalContext(db.client, {
      kind: "EVENT",
      title: "Inventory Prep",
      start_date: "2026-09-01",
      end_date: "2026-09-15",
      store_id: "store-2587",
      declared_by: "master-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const set = await setOperationalContextDepartmentRelevance(db.client, {
      context_id: created.context.id,
      store_id: "store-2587",
      department_code: "flooring",
      relevance: "HIGH",
    });
    expect(set.ok && set.relevance?.relevance).toBe("HIGH");

    const cleared = await setOperationalContextDepartmentRelevance(db.client, {
      context_id: created.context.id,
      store_id: "store-2587",
      department_code: "flooring",
      relevance: null,
    });
    expect(cleared.ok && cleared.relevance).toBeNull();
  });

  it("cannot mutate other-store context", async () => {
    const db = createFakeOperationalContextDb();
    const created = await createMasterDeclaredOperationalContext(db.client, {
      kind: "EVENT",
      title: "Other",
      start_date: "2026-09-01",
      end_date: "2026-09-15",
      store_id: "store-9999",
      declared_by: "master-1",
    });
    if (!created.ok) return;
    const del = await deleteMasterDeclaredOperationalContext(db.client, {
      id: created.context.id,
      store_id: "store-2587",
    });
    expect(del.ok).toBe(false);
    if (del.ok) return;
    expect(del.code).toBe("forbidden");
  });

  it("resolveOperationalContextsForDate loads from DB", async () => {
    const db = createFakeOperationalContextDb();
    await createMasterDeclaredOperationalContext(db.client, {
      kind: "SEASON",
      title: "Late Summer",
      start_date: "2026-08-01",
      end_date: "2026-09-30",
      store_id: "store-2587",
      declared_by: "master-1",
    });
    const result = await resolveOperationalContextsForDate(db.client, {
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      departmentCode: "flooring",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.active_seasons).toHaveLength(1);
  });
});

describe("FS-002 auth contracts", () => {
  const master: StoreOpsActor = {
    userId: "u-master",
    specialistId: "s-master",
    role: "super_admin",
    departmentCode: null,
    accessibleDepartmentCodes: [],
    storeNumber: "2587",
  };
  const supervisor: StoreOpsActor = {
    userId: "u-ds",
    specialistId: "s-ds",
    role: "department_supervisor",
    departmentCode: "flooring",
    accessibleDepartmentCodes: ["flooring"],
    storeNumber: "2587",
  };

  it("unauthenticated → 401", () => {
    try {
      requireStoreOpsActor(null);
      expect.fail("expected throw");
    } catch (err) {
      expect((err as StoreOpsAuthError).status).toBe(401);
    }
  });

  it("Supervisor blocked from SuperAdmin writes → 403", () => {
    try {
      requireSuperAdmin(supervisor);
      expect.fail("expected throw");
    } catch (err) {
      expect((err as StoreOpsAuthError).status).toBe(403);
    }
  });

  it("Master passes requireSuperAdmin", () => {
    expect(requireSuperAdmin(master)).toEqual(master);
  });

  it("route sources enforce actor chains and no rotation imports", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const read = async (...parts: string[]) =>
      fs.readFile(path.resolve(__dirname, ...parts), "utf8");

    const listRoute = await read(
      "../../app/api/operational-contexts/route.ts"
    );
    expect(listRoute).toMatch(/requireSupervisorOrAdmin/);
    expect(listRoute).toMatch(/resolveOperationalContextsForDate|listOperationalContextsForStore/);

    const createRoute = await read(
      "../../app/api/admin/operational-contexts/route.ts"
    );
    expect(createRoute).toMatch(/requireSuperAdmin/);
    expect(createRoute).toMatch(/requireStoreOpsActor/);
    expect(createRoute).toMatch(/MASTER_ADMIN_DECLARED|createMasterDeclared/);
    expect(createRoute).not.toMatch(/COMPANY_PUBLISHED/);

    const domain = await read("./operational-context.ts");
    expect(domain).not.toMatch(/manual_priority_count/);
    expect(domain).not.toMatch(/velocity_tier/);
    expect(domain).not.toMatch(/priority_override/);
    expect(domain).not.toMatch(/assigned_week/);
    expect(domain).not.toMatch(/from \"\.\/rotations\"/);
    expect(domain).not.toMatch(/from \"\.\/week\"/);
  });
});

describe("FS-002 rotation independence", () => {
  it("rotations and week draw do not import operational-context", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const rotations = await fs.readFile(
      path.resolve(__dirname, "rotations.ts"),
      "utf8"
    );
    const week = await fs.readFile(path.resolve(__dirname, "week.ts"), "utf8");
    const velocity = await fs.readFile(
      path.resolve(__dirname, "velocity.ts"),
      "utf8"
    );
    expect(rotations).not.toMatch(/operational-context/);
    expect(week).not.toMatch(/operational-context/);
    expect(velocity).not.toMatch(/operational-context/);
  });
});
