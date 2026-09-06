/**
 * FS-003 location seasonal relevance tests — synthetic fixtures only.
 */

import { describe, expect, it } from "vitest";
import { createFakeOperationalContextDb } from "./operational-context.fake";
import {
  createMasterDeclaredOperationalContext,
  resolveLocationContextRelevanceFromRows,
  setOperationalContextLocationRelevance,
  type OperationalContext,
  type OperationalContextLocationRelevance,
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

function locRel(
  partial: Pick<
    OperationalContextLocationRelevance,
    "context_id" | "location_id" | "relevance"
  > &
    Partial<OperationalContextLocationRelevance>
): OperationalContextLocationRelevance {
  return {
    id: partial.id ?? `lr-${partial.location_id}`,
    declared_by: partial.declared_by ?? "master-user",
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
    ...partial,
  };
}

describe("FS-003 location relevance resolution", () => {
  it("HIGH location relevance on active context", () => {
    const season = ctx({
      id: "s1",
      kind: "SEASON",
      title: "Late Summer",
      start_date: "2026-08-01",
      end_date: "2026-09-30",
    });
    const result = resolveLocationContextRelevanceFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts: [season],
      location_relevance: [
        locRel({ context_id: "s1", location_id: "bay-14", relevance: "HIGH" }),
      ],
      locations: [
        { id: "bay-14", store_id: "store-2587", is_active: true },
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.location_relevance).toBe("HIGH");
    expect(result.items[0]!.title).toBe("Late Summer");
  });

  it("explicit NONE is preserved", () => {
    const season = ctx({
      id: "s1",
      kind: "SEASON",
      title: "Late Summer",
      start_date: "2026-08-01",
      end_date: "2026-09-30",
    });
    const result = resolveLocationContextRelevanceFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts: [season],
      location_relevance: [
        locRel({ context_id: "s1", location_id: "bay-14", relevance: "NONE" }),
      ],
      locations: [
        { id: "bay-14", store_id: "store-2587", is_active: true },
      ],
    });
    expect(result.items[0]!.location_relevance).toBe("NONE");
  });

  it("UNSET — no row means no item", () => {
    const season = ctx({
      id: "s1",
      kind: "SEASON",
      title: "Late Summer",
      start_date: "2026-08-01",
      end_date: "2026-09-30",
    });
    const result = resolveLocationContextRelevanceFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts: [season],
      location_relevance: [],
      locations: [
        { id: "bay-14", store_id: "store-2587", is_active: true },
      ],
    });
    expect(result.items).toHaveLength(0);
  });

  it("does not inherit department HIGH into locations", () => {
    // Pure location resolver never sees department rows — empty location_relevance
    // with active context → no fabricated location items.
    const season = ctx({
      id: "s1",
      kind: "SEASON",
      title: "Late Summer",
      start_date: "2026-08-01",
      end_date: "2026-09-30",
    });
    const result = resolveLocationContextRelevanceFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts: [season],
      location_relevance: [],
      locations: [
        { id: "bay-14", store_id: "store-2587", is_active: true },
        { id: "bay-22", store_id: "store-2587", is_active: true },
      ],
    });
    expect(result.items).toEqual([]);
  });

  it("inactive location omitted from active resolve", () => {
    const season = ctx({
      id: "s1",
      kind: "SEASON",
      title: "Late Summer",
      start_date: "2026-08-01",
      end_date: "2026-09-30",
    });
    const result = resolveLocationContextRelevanceFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts: [season],
      location_relevance: [
        locRel({ context_id: "s1", location_id: "bay-14", relevance: "HIGH" }),
      ],
      locations: [
        { id: "bay-14", store_id: "store-2587", is_active: false },
      ],
    });
    expect(result.items).toHaveLength(0);
  });

  it("context outside date window → relation not active", () => {
    const season = ctx({
      id: "s1",
      kind: "SEASON",
      title: "Late Summer",
      start_date: "2026-08-01",
      end_date: "2026-08-31",
    });
    const result = resolveLocationContextRelevanceFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts: [season],
      location_relevance: [
        locRel({ context_id: "s1", location_id: "bay-14", relevance: "HIGH" }),
      ],
      locations: [
        { id: "bay-14", store_id: "store-2587", is_active: true },
      ],
    });
    expect(result.items).toHaveLength(0);
  });

  it("same location different overlapping contexts", () => {
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
    ];
    const result = resolveLocationContextRelevanceFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts,
      location_relevance: [
        locRel({ context_id: "s1", location_id: "bay-14", relevance: "HIGH" }),
        locRel({ context_id: "e1", location_id: "bay-14", relevance: "MEDIUM" }),
      ],
      locations: [
        { id: "bay-14", store_id: "store-2587", is_active: true },
      ],
    });
    expect(result.items).toHaveLength(2);
  });

  it("cross-store location row ignored by store filter", () => {
    const season = ctx({
      id: "s1",
      kind: "SEASON",
      title: "Late Summer",
      start_date: "2026-08-01",
      end_date: "2026-09-30",
      store_id: null,
    });
    const result = resolveLocationContextRelevanceFromRows({
      operationalDate: "2026-09-05",
      storeId: "store-2587",
      contexts: [season],
      location_relevance: [
        locRel({ context_id: "s1", location_id: "other-bay", relevance: "HIGH" }),
      ],
      locations: [
        { id: "other-bay", store_id: "store-9999", is_active: true },
      ],
    });
    expect(result.items).toHaveLength(0);
  });
});

describe("FS-003 location relevance writes", () => {
  it("Master sets HIGH and clears to UNSET", async () => {
    const db = createFakeOperationalContextDb();
    db.seedLocation({ id: "bay-14", store_id: "store-2587" });
    const created = await createMasterDeclaredOperationalContext(db.client, {
      store_id: "store-2587",
      kind: "SEASON",
      title: "Late Summer",
      start_date: "2026-08-01",
      end_date: "2026-09-30",
      declared_by: "master-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const set = await setOperationalContextLocationRelevance(db.client, {
      context_id: created.context.id,
      store_id: "store-2587",
      location_id: "bay-14",
      relevance: "HIGH",
      declared_by: "master-1",
    });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.relevance?.relevance).toBe("HIGH");
    expect(db.locations[0]!.manual_priority_count).toBe(0);
    expect(db.locations[0]!.velocity_tier).toBe("standard");
    expect(db.locations[0]!.priority_override).toBe(false);

    const cleared = await setOperationalContextLocationRelevance(db.client, {
      context_id: created.context.id,
      store_id: "store-2587",
      location_id: "bay-14",
      relevance: null,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.relevance).toBeNull();
    expect(db.locationRelevance).toHaveLength(0);
  });

  it("rejects cross-store location", async () => {
    const db = createFakeOperationalContextDb();
    db.seedLocation({ id: "bay-x", store_id: "store-other" });
    const created = await createMasterDeclaredOperationalContext(db.client, {
      store_id: "store-2587",
      kind: "SEASON",
      title: "Late Summer",
      start_date: "2026-08-01",
      end_date: "2026-09-30",
      declared_by: "master-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const set = await setOperationalContextLocationRelevance(db.client, {
      context_id: created.context.id,
      store_id: "store-2587",
      location_id: "bay-x",
      relevance: "HIGH",
    });
    expect(set.ok).toBe(false);
    if (set.ok) return;
    expect(set.code).toBe("forbidden");
  });

  it("context delete cascades location relevance in fake", async () => {
    const db = createFakeOperationalContextDb();
    db.seedLocation({ id: "bay-14", store_id: "store-2587" });
    const created = await createMasterDeclaredOperationalContext(db.client, {
      store_id: "store-2587",
      kind: "SEASON",
      title: "Late Summer",
      start_date: "2026-08-01",
      end_date: "2026-09-30",
      declared_by: "master-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await setOperationalContextLocationRelevance(db.client, {
      context_id: created.context.id,
      store_id: "store-2587",
      location_id: "bay-14",
      relevance: "MEDIUM",
    });
    expect(db.locationRelevance).toHaveLength(1);

    const { deleteMasterDeclaredOperationalContext } = await import(
      "./operational-context"
    );
    await deleteMasterDeclaredOperationalContext(db.client, {
      id: created.context.id,
      store_id: "store-2587",
    });
    expect(db.locationRelevance).toHaveLength(0);
  });
});

describe("FS-003 auth + rotation independence", () => {
  it("Supervisor cannot pass requireSuperAdmin for writes", () => {
    const actor: StoreOpsActor = {
      userId: "u1",
      specialistId: "s1",
      role: "department_supervisor",
      departmentCode: "flooring",
      accessibleDepartmentCodes: ["flooring"],
      storeNumber: "2587",
    };
    expect(() => requireSuperAdmin(requireStoreOpsActor(actor))).toThrow(
      StoreOpsAuthError
    );
  });

  it("Master passes requireSuperAdmin", () => {
    const actor: StoreOpsActor = {
      userId: "u1",
      specialistId: "s1",
      role: "super_admin",
      departmentCode: null,
      accessibleDepartmentCodes: [],
      storeNumber: "2587",
    };
    expect(requireSuperAdmin(requireStoreOpsActor(actor)).role).toBe(
      "super_admin"
    );
  });

  it("domain does not import rotation engines or mutate priority vocabulary as writes", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "operational-context.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/from ["'].*rotations/);
    expect(source).not.toMatch(/from ["'].*\/week/);
    expect(source).not.toMatch(/from ["'].*sunday-schedule/);
    expect(source).not.toMatch(/manual_priority_count\s*:/);
    expect(source).not.toMatch(/velocity_tier\s*:/);
    expect(source).not.toMatch(/priority_override\s*:/);
  });

  it("rotations/week do not import location relevance", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    for (const file of [
      "rotations.ts",
      "week.ts",
      "sunday-schedule.ts",
      "rotation.ts",
      "rotation-metrics.ts",
    ]) {
      const source = await fs.readFile(path.resolve(__dirname, file), "utf8");
      expect(source).not.toMatch(/location_relevance/);
      expect(source).not.toMatch(/operational_context_location/);
    }
  });
});
