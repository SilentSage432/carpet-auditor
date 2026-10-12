/**
 * WALK-002/003 — place ownership resolve, session reuse, trusted section bind.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  createWalkthroughObservation,
  ensureActiveWalkthroughSession,
  findActiveWalkthroughSessionForStore,
  resolveWalkthroughPlaceOwnership,
} from "./walkthroughs";

type Row = Record<string, unknown>;

type MockDb = {
  locations: Row[];
  members: Row[];
  sections: Row[];
  specialists: Row[];
  sessions: Row[];
  observations: Row[];
  inserts: Array<{ table: string; row: Row }>;
};

function createMockSupabase(db: MockDb) {
  function from(table: string) {
    const state: {
      filters: Row;
      inFilters: Record<string, unknown[]>;
      op: "select" | "insert" | "update";
      insertRow?: Row;
      orderCol?: string;
      ascending?: boolean;
    } = { filters: {}, inFilters: {}, op: "select" };

    const executeList = async () => {
      if (table === "operational_section_members") {
        const rows = db.members.filter((m) =>
          Object.entries(state.filters).every(
            ([k, v]) => String(m[k]) === String(v)
          )
        );
        return { data: rows, error: null };
      }
      if (table === "operational_sections") {
        const rows = db.sections.filter((s) => {
          if (
            state.filters.store_id != null &&
            String(s.store_id) !== String(state.filters.store_id)
          ) {
            return false;
          }
          if (
            state.filters.is_active != null &&
            Boolean(s.is_active) !== Boolean(state.filters.is_active)
          ) {
            return false;
          }
          if (state.filters.id != null && String(s.id) !== String(state.filters.id)) {
            return false;
          }
          if (state.inFilters.id) {
            return state.inFilters.id.map(String).includes(String(s.id));
          }
          return true;
        });
        return { data: rows, error: null };
      }
      if (table === "store_specialists") {
        const ids = (state.inFilters.id ?? []).map(String);
        if (state.filters.id != null) {
          const row = db.specialists.find(
            (s) =>
              String(s.id) === String(state.filters.id) &&
              (state.inFilters.store_number ?? [])
                .map(String)
                .includes(String(s.store_number ?? ""))
          );
          return { data: row ? [{ id: row.id, name: row.name }] : [], error: null };
        }
        const rows = db.specialists
          .filter((s) => ids.includes(String(s.id)))
          .map((s) => ({ id: s.id, name: s.name }));
        return { data: rows, error: null };
      }
      return { data: [], error: null };
    };

    const api: Record<string, unknown> = {
      select(_cols?: string) {
        if (state.op !== "insert" && state.op !== "update") {
          state.op = "select";
        }
        return api;
      },
      insert(row: Row) {
        state.op = "insert";
        state.insertRow = row;
        db.inserts.push({ table, row });
        return api;
      },
      update(_patch: Row) {
        state.op = "update";
        return api;
      },
      eq(col: string, val: unknown) {
        state.filters[col] = val;
        return api;
      },
      in(col: string, vals: unknown[]) {
        state.inFilters[col] = vals;
        return api;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        state.orderCol = col;
        state.ascending = opts?.ascending;
        return api;
      },
      limit(_n: number) {
        return api;
      },
      maybeSingle: async () => {
        if (table === "store_locations") {
          const row = db.locations.find((loc) =>
            Object.entries(state.filters).every(
              ([k, v]) => String(loc[k]) === String(v)
            )
          );
          return { data: row ? { id: row.id } : null, error: null };
        }
        if (table === "walkthrough_sessions") {
          let rows = db.sessions.filter((s) =>
            Object.entries(state.filters).every(
              ([k, v]) => String(s[k]) === String(v)
            )
          );
          if (state.orderCol === "started_at") {
            rows = [...rows].sort((a, b) =>
              String(a.started_at).localeCompare(String(b.started_at))
            );
            if (state.ascending === false) rows.reverse();
          }
          return { data: rows[0] ?? null, error: null };
        }
        if (table === "operational_sections") {
          const id = String(state.filters.id ?? "");
          const storeId = String(state.filters.store_id ?? "");
          const row = db.sections.find(
            (s) => String(s.id) === id && String(s.store_id) === storeId
          );
          return { data: row ?? null, error: null };
        }
        if (table === "store_specialists") {
          const id = String(state.filters.id ?? "");
          const allowed = (state.inFilters.store_number ?? []).map(String);
          const row = db.specialists.find(
            (s) =>
              String(s.id) === id &&
              allowed.includes(String(s.store_number ?? ""))
          );
          return { data: row ? { id: row.id } : null, error: null };
        }
        return { data: null, error: null };
      },
      single: async () => {
        if (state.op === "insert" && state.insertRow) {
          const created = {
            id: `${table}-${db.inserts.length}`,
            created_at: "2026-10-12T12:00:00.000Z",
            updated_at: "2026-10-12T12:00:00.000Z",
            ...state.insertRow,
          };
          if (table === "walkthrough_sessions") db.sessions.push(created);
          if (table === "walkthrough_observations")
            db.observations.push(created);
          return { data: created, error: null };
        }
        return { data: null, error: { message: "unexpected single" } };
      },
      then(
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        return executeList().then(onFulfilled, onRejected);
      },
    };

    return api;
  }

  return { from } as never;
}

function baseDb(): MockDb {
  return {
    locations: [
      { id: "loc-1", department_id: "dept-f", aisle: "5", bay: 12 },
      { id: "loc-2", department_id: "dept-f", aisle: "99", bay: 1 },
    ],
    members: [
      {
        section_id: "sec-tyson",
        department_id: "dept-f",
        aisle: "5",
        bay: 12,
      },
    ],
    sections: [
      {
        id: "sec-tyson",
        store_id: "store-a",
        name: "Myself",
        primary_owner_specialist_id: "spec-tyson",
        is_active: true,
      },
      {
        id: "sec-foreign",
        store_id: "store-b",
        name: "Foreign",
        primary_owner_specialist_id: "spec-x",
        is_active: true,
      },
    ],
    specialists: [
      { id: "spec-tyson", name: "Tyson", store_number: "2587" },
      { id: "spec-x", name: "Other", store_number: "1852" },
    ],
    sessions: [
      {
        id: "sess-active",
        store_id: "store-a",
        status: "active",
        department_id: null,
        companion_specialist_id: null,
        focus_section_id: null,
        notes: null,
        started_at: "2026-10-12T10:00:00.000Z",
        ended_at: null,
        created_by_specialist_id: "op",
        created_at: "2026-10-12T10:00:00.000Z",
        updated_at: "2026-10-12T10:00:00.000Z",
      },
    ],
    observations: [],
    inserts: [],
  };
}

describe("WALK-002 place ownership resolve", () => {
  let db: MockDb;

  beforeEach(() => {
    db = baseDb();
  });

  it("resolves section owner from persisted memberships", async () => {
    const client = createMockSupabase(db);
    const result = await resolveWalkthroughPlaceOwnership(client, {
      store_id: "store-a",
      department_id: "dept-f",
      aisle: "5",
      bay: 12,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      status: "owned",
      section_id: "sec-tyson",
      primary_owner_name: "Tyson",
      label: "Section owner: Tyson",
    });
  });

  it("reports unsectioned honestly when no membership", async () => {
    const client = createMockSupabase(db);
    const result = await resolveWalkthroughPlaceOwnership(client, {
      store_id: "store-a",
      department_id: "dept-f",
      aisle: "99",
      bay: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("unsectioned");
  });

  it("reports ambiguous when two active sections claim the bay", async () => {
    db.members.push({
      section_id: "sec-other",
      department_id: "dept-f",
      aisle: "5",
      bay: 12,
    });
    db.sections.push({
      id: "sec-other",
      store_id: "store-a",
      name: "Conflict",
      primary_owner_specialist_id: "spec-tyson",
      is_active: true,
    });
    const client = createMockSupabase(db);
    const result = await resolveWalkthroughPlaceOwnership(client, {
      store_id: "store-a",
      department_id: "dept-f",
      aisle: "5",
      bay: 12,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("ambiguous");
    expect(result.value.section_id).toBeNull();
  });
});

describe("WALK-002 session reuse", () => {
  it("finds active session and ensureActive does not duplicate", async () => {
    const db = baseDb();
    const client = createMockSupabase(db);
    const found = await findActiveWalkthroughSessionForStore(client, {
      store_id: "store-a",
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value?.id).toBe("sess-active");

    const ensured = await ensureActiveWalkthroughSession(client, {
      store_id: "store-a",
      store_number: "2587",
    });
    expect(ensured.ok).toBe(true);
    if (!ensured.ok) return;
    expect(ensured.value.id).toBe("sess-active");
    expect(ensured.created).toBe(false);
    expect(
      db.inserts.filter((i) => i.table === "walkthrough_sessions")
    ).toHaveLength(0);
  });

  it("creates a session only when none are active", async () => {
    const db = baseDb();
    db.sessions = [];
    const client = createMockSupabase(db);
    const ensured = await ensureActiveWalkthroughSession(client, {
      store_id: "store-a",
      store_number: "2587",
      department_id: "dept-f",
    });
    expect(ensured.ok).toBe(true);
    if (!ensured.ok) return;
    expect(ensured.created).toBe(true);
    expect(
      db.inserts.some((i) => i.table === "walkthrough_sessions")
    ).toBe(true);
  });
});

describe("WALK-002 trusted section bind on place-bound create", () => {
  it("binds section from membership and ignores client section_id", async () => {
    const db = baseDb();
    const client = createMockSupabase(db);
    const result = await createWalkthroughObservation(client, {
      store_id: "store-a",
      store_number: "2587",
      session_id: "sess-active",
      observation_type: "opportunity",
      body: "Facing soft",
      department_id: "dept-f",
      aisle: "5",
      bay: 12,
      section_id: "sec-foreign",
      associate_specialist_id: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.section_id).toBe("sec-tyson");
    expect(result.value.associate_specialist_id).toBeNull();
    expect(result.value.aisle).toBe("5");
    expect(result.value.bay).toBe(12);
    expect(
      db.inserts.some((i) => i.table === "walkthrough_follow_ups")
    ).toBe(false);
  });

  it("rejects invented places not on the map", async () => {
    const db = baseDb();
    const client = createMockSupabase(db);
    const result = await createWalkthroughObservation(client, {
      store_id: "store-a",
      store_number: "2587",
      session_id: "sess-active",
      observation_type: "general",
      body: "Ghost bay",
      department_id: "dept-f",
      aisle: "5",
      bay: 999,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "not_found",
      message: "Location not found on the store map",
    });
  });

  it("does not auto-create follow-ups from ownership", async () => {
    const db = baseDb();
    const client = createMockSupabase(db);
    const result = await createWalkthroughObservation(client, {
      store_id: "store-a",
      store_number: "2587",
      session_id: "sess-active",
      observation_type: "positive",
      body: "Looks good",
      department_id: "dept-f",
      aisle: "5",
      bay: 12,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.section_id).toBe("sec-tyson");
    expect(
      db.inserts.filter((i) => i.table === "walkthrough_follow_ups")
    ).toHaveLength(0);
  });
});
