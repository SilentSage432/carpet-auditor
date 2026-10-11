/**
 * RD-3-FIX-001 — store-scoped membership mutations.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadOperationalSectionForStore,
  removeOperationalSectionMembers,
  retireOperationalSection,
  sectionBayKey,
  findActiveBayMembershipConflicts,
  normalizeSectionBayRef,
  indexBaySectionLookups,
  formatUnsectionedLabel,
  type OperationalSectionView,
} from "./operational-sections";
import { normalizeAisle } from "./aisle";

type Row = Record<string, unknown>;

function createMockSupabase(opts: {
  sectionByIdStore?: Map<string, Row | null>;
  members?: Row[];
}) {
  const deleted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const inserted: Row[] = [];

  function from(table: string) {
    const state: {
      filters: Record<string, unknown>;
      op: "select" | "delete" | "update" | "insert";
      patch?: Row;
    } = { filters: {}, op: "select" };

    const api = {
      select() {
        state.op = "select";
        return api;
      },
      insert(row: Row) {
        state.op = "insert";
        inserted.push(row);
        return {
          then: undefined,
          error: null,
        };
      },
      update(patch: Row) {
        state.op = "update";
        state.patch = patch;
        return api;
      },
      delete(opts?: { count?: string }) {
        void opts;
        state.op = "delete";
        return api;
      },
      eq(col: string, val: unknown) {
        state.filters[col] = val;
        return api;
      },
      maybeSingle: async () => {
        if (table !== "operational_sections") {
          return { data: null, error: null };
        }
        const id = String(state.filters.id ?? "");
        const storeId = String(state.filters.store_id ?? "");
        const key = `${id}|${storeId}`;
        const row = opts.sectionByIdStore?.get(key) ?? null;
        return { data: row, error: null };
      },
      single: async () => {
        if (state.op === "update" && table === "operational_sections") {
          const id = String(state.filters.id ?? "");
          const storeId = String(state.filters.store_id ?? "");
          const key = `${id}|${storeId}`;
          const prior = opts.sectionByIdStore?.get(key);
          if (!prior) return { data: null, error: { message: "missing" } };
          const next = { ...prior, ...state.patch };
          updated.push({ table, filters: { ...state.filters }, patch: state.patch });
          return { data: next, error: null };
        }
        return { data: null, error: { message: "unexpected single" } };
      },
      then: undefined as unknown,
    };

    // Make delete/select awaitable as query result
    (api as { then?: unknown }).then = (
      resolve: (v: unknown) => unknown
    ) => {
      if (state.op === "delete" && table === "operational_section_members") {
        deleted.push({ ...state.filters });
        const count =
          opts.members?.filter((m) => {
            return Object.entries(state.filters).every(
              ([k, v]) => String(m[k]) === String(v)
            );
          }).length ?? 0;
        return Promise.resolve(resolve({ data: null, error: null, count }));
      }
      if (state.op === "select" && table === "operational_section_members") {
        const rows =
          opts.members?.filter((m) => {
            return Object.entries(state.filters).every(
              ([k, v]) => String(m[k]) === String(v)
            );
          }) ?? [];
        return Promise.resolve(resolve({ data: rows, error: null }));
      }
      if (state.op === "insert") {
        return Promise.resolve(resolve({ data: null, error: null }));
      }
      return Promise.resolve(resolve({ data: null, error: null }));
    };

    return api;
  }

  return {
    client: { from } as never,
    deleted,
    updated,
    inserted,
  };
}

describe("RD-3-FIX-001 store ownership on remove/retire", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loadOperationalSectionForStore rejects foreign store", async () => {
    const map = new Map<string, Row | null>([
      [
        "sec-1|store-a",
        {
          id: "sec-1",
          store_id: "store-a",
          department_id: "d1",
          name: "A",
          description: null,
          primary_owner_specialist_id: null,
          is_active: true,
          retired_at: null,
          created_at: "",
          updated_at: "",
        },
      ],
    ]);
    const mock = createMockSupabase({ sectionByIdStore: map });
    const miss = await loadOperationalSectionForStore(mock.client, {
      section_id: "sec-1",
      store_id: "store-b",
    });
    expect(miss).toMatchObject({ ok: false, code: "not_found" });

    const hit = await loadOperationalSectionForStore(mock.client, {
      section_id: "sec-1",
      store_id: "store-a",
    });
    expect(hit.ok).toBe(true);
  });

  it("cross-store membership removal is rejected and deletes nothing", async () => {
    const map = new Map<string, Row | null>([
      [
        "sec-1|store-a",
        {
          id: "sec-1",
          store_id: "store-a",
          department_id: "d1",
          name: "A",
          is_active: true,
          retired_at: null,
          description: null,
          primary_owner_specialist_id: null,
          created_at: "",
          updated_at: "",
        },
      ],
    ]);
    const mock = createMockSupabase({
      sectionByIdStore: map,
      members: [
        {
          id: "m1",
          section_id: "sec-1",
          store_id: "store-a",
          department_id: "d1",
          aisle: "12",
          bay: 1,
        },
      ],
    });

    const result = await removeOperationalSectionMembers(mock.client, {
      section_id: "sec-1",
      store_id: "store-b",
      members: [{ department_id: "d1", aisle: "12", bay: 1 }],
    });
    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(mock.deleted).toHaveLength(0);
  });

  it("missing section is rejected", async () => {
    const mock = createMockSupabase({ sectionByIdStore: new Map() });
    const result = await removeOperationalSectionMembers(mock.client, {
      section_id: "missing",
      store_id: "store-a",
      members: [{ department_id: "d1", aisle: "12", bay: 1 }],
    });
    expect(result).toMatchObject({ ok: false, code: "not_found" });
  });

  it("authorized removal succeeds and scopes delete by store_id", async () => {
    const map = new Map<string, Row | null>([
      [
        "sec-1|store-a",
        {
          id: "sec-1",
          store_id: "store-a",
          department_id: "d1",
          name: "A",
          is_active: true,
          retired_at: null,
          description: null,
          primary_owner_specialist_id: null,
          created_at: "",
          updated_at: "",
        },
      ],
    ]);
    const mock = createMockSupabase({
      sectionByIdStore: map,
      members: [
        {
          id: "m1",
          section_id: "sec-1",
          store_id: "store-a",
          department_id: "d1",
          aisle: "12",
          bay: 1,
        },
      ],
    });

    const result = await removeOperationalSectionMembers(mock.client, {
      section_id: "sec-1",
      store_id: "store-a",
      members: [{ department_id: "d1", aisle: "12", bay: 1 }],
    });
    expect(result).toEqual({ ok: true, value: { removed: 1 } });
    expect(mock.deleted[0]).toMatchObject({
      section_id: "sec-1",
      store_id: "store-a",
      department_id: "d1",
      aisle: "12",
      bay: 1,
    });
  });

  it("retire refuses foreign store before touching members", async () => {
    const map = new Map<string, Row | null>([
      [
        "sec-1|store-a",
        {
          id: "sec-1",
          store_id: "store-a",
          department_id: "d1",
          name: "A",
          is_active: true,
          retired_at: null,
          description: null,
          primary_owner_specialist_id: null,
          created_at: "",
          updated_at: "",
        },
      ],
    ]);
    const mock = createMockSupabase({
      sectionByIdStore: map,
      members: [
        {
          section_id: "sec-1",
          store_id: "store-a",
          department_id: "d1",
          aisle: "12",
          bay: 1,
        },
      ],
    });
    const result = await retireOperationalSection(mock.client, {
      section_id: "sec-1",
      store_id: "store-b",
    });
    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(mock.deleted).toHaveLength(0);
    expect(mock.updated).toHaveLength(0);
  });
});

describe("RD-3-FIX-001 aisle normalization conflicts", () => {
  it("case-equivalent aisles share one physical bay key", () => {
    expect(
      sectionBayKey({ department_id: "d1", aisle: "bw", bay: 1 })
    ).toBe(sectionBayKey({ department_id: "d1", aisle: "BW", bay: 1 }));
  });

  it("whitespace-equivalent aisles share one physical bay key", () => {
    const a = normalizeSectionBayRef({
      department_id: "d1",
      aisle: "  rw  01  ",
      bay: 2,
    });
    const b = normalizeSectionBayRef({
      department_id: "d1",
      aisle: "RW 01",
      bay: 2,
    });
    expect(a.aisle).toBe("RW 01");
    expect(a).toEqual(b);
    expect(sectionBayKey(a)).toBe(sectionBayKey(b));
  });

  it("case/whitespace equivalents conflict across active sections", () => {
    const conflicts = findActiveBayMembershipConflicts([
      {
        section_id: "s1",
        section_is_active: true,
        department_id: "d1",
        aisle: "bw",
        bay: 1,
      },
      {
        section_id: "s2",
        section_is_active: true,
        department_id: "d1",
        aisle: " BW ",
        bay: 1,
      },
    ]);
    expect(conflicts).toEqual(["d1|BW|1"]);
  });

  it("retire+reactivate remains conflict-safe when bay moved", () => {
    // After retire, original section has no active membership rows.
    // Bay claimed by s2; reactivating s1 empty does not conflict.
    const after = findActiveBayMembershipConflicts([
      {
        section_id: "s1",
        section_is_active: true,
        department_id: "d1",
        aisle: "12",
        bay: 1,
      },
      {
        section_id: "s2",
        section_is_active: true,
        department_id: "d1",
        aisle: "12",
        bay: 1,
      },
    ]);
    expect(after).toContain("d1|12|1");

    const safe = findActiveBayMembershipConflicts([
      {
        section_id: "s1",
        section_is_active: true,
        department_id: "d1",
        aisle: "12",
        bay: 9,
      },
      {
        section_id: "s2",
        section_is_active: true,
        department_id: "d1",
        aisle: "12",
        bay: 1,
      },
    ]);
    expect(safe).toEqual([]);
  });

  it("DB aisle normalize expression matches app normalizeAisle", () => {
    // Mirrors migration: regexp_replace(upper(trim(aisle)), '\s+', ' ', 'g')
    const sqlNormalize = (raw: string) =>
      raw
        .trim()
        .toUpperCase()
        .replace(/\s+/g, " ");
    for (const sample of ["bw", " BW ", "  rw  01  ", "12", "a1"]) {
      expect(sqlNormalize(sample)).toBe(normalizeAisle(sample));
    }
  });
});

describe("RD-3-FIX-001 Map section index intact", () => {
  it("indexBaySectionLookups maps active membership; skips retired; unsectioned label stable", () => {
    const sections: OperationalSectionView[] = [
      {
        id: "s1",
        store_id: "store-a",
        department_id: "d1",
        name: "Front Runners",
        description: null,
        primary_owner_specialist_id: null,
        is_active: true,
        retired_at: null,
        created_at: "",
        updated_at: "",
        member_count: 1,
        members: [
          {
            id: "m1",
            section_id: "s1",
            store_id: "store-a",
            department_id: "d1",
            aisle: "BW",
            bay: 1,
            created_at: "",
          },
        ],
      },
      {
        id: "s-retired",
        store_id: "store-a",
        department_id: "d1",
        name: "Old",
        description: null,
        primary_owner_specialist_id: null,
        is_active: false,
        retired_at: "2026-01-01",
        created_at: "",
        updated_at: "",
        member_count: 0,
        members: [
          {
            id: "m2",
            section_id: "s-retired",
            store_id: "store-a",
            department_id: "d1",
            aisle: "RW",
            bay: 2,
            created_at: "",
          },
        ],
      },
    ];
    const index = indexBaySectionLookups(sections);
    expect(index.get("d1|BW|1")?.section_name).toBe("Front Runners");
    expect(index.has("d1|RW|2")).toBe(false);
    expect(formatUnsectionedLabel()).toBe("Unsectioned");
  });
});
