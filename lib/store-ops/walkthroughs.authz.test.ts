/**
 * RD-5-FIX — store relationship integrity + completion independence.
 * Behavioral tests through domain authorization paths (not source-text only).
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  assertOperationalSectionForStore,
  assertRosterSpecialistForStore,
  completeWalkthroughFollowUp,
  createWalkthroughFollowUp,
  createWalkthroughObservation,
  endWalkthroughSession,
  startWalkthroughSession,
} from "./walkthroughs";

type Row = Record<string, unknown>;

type MockDb = {
  specialists: Row[];
  sections: Row[];
  sessions: Row[];
  observations: Row[];
  followUps: Row[];
  /** Tables touched by write ops — used for independence asserts */
  touched: string[];
  updates: Array<{ table: string; filters: Row; patch: Row }>;
  inserts: Array<{ table: string; row: Row }>;
};

function createMockSupabase(db: MockDb) {
  function from(table: string) {
    const state: {
      filters: Row;
      inFilters: Record<string, unknown[]>;
      op: "select" | "insert" | "update";
      patch?: Row;
      insertRow?: Row;
    } = { filters: {}, inFilters: {}, op: "select" };

    const api = {
      select(_cols?: string) {
        // Preserve insert/update when chaining .insert().select().single()
        if (state.op !== "insert" && state.op !== "update") {
          state.op = "select";
        }
        return api;
      },
      insert(row: Row) {
        state.op = "insert";
        state.insertRow = row;
        db.touched.push(table);
        db.inserts.push({ table, row });
        return api;
      },
      update(patch: Row) {
        state.op = "update";
        state.patch = patch;
        db.touched.push(table);
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
      maybeSingle: async () => {
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
        if (table === "operational_sections") {
          const id = String(state.filters.id ?? "");
          const storeId = String(state.filters.store_id ?? "");
          const row = db.sections.find(
            (s) => String(s.id) === id && String(s.store_id) === storeId
          );
          return { data: row ?? null, error: null };
        }
        if (table === "walkthrough_sessions") {
          const id = String(state.filters.id ?? "");
          const storeId = String(state.filters.store_id ?? "");
          const row = db.sessions.find(
            (s) => String(s.id) === id && String(s.store_id) === storeId
          );
          return { data: row ?? null, error: null };
        }
        if (table === "walkthrough_observations") {
          const id = String(state.filters.id ?? "");
          const storeId = String(state.filters.store_id ?? "");
          const row = db.observations.find(
            (s) => String(s.id) === id && String(s.store_id) === storeId
          );
          return { data: row ?? null, error: null };
        }
        if (table === "walkthrough_follow_ups") {
          const id = String(state.filters.id ?? "");
          const storeId = String(state.filters.store_id ?? "");
          const row = db.followUps.find(
            (s) => String(s.id) === id && String(s.store_id) === storeId
          );
          return { data: row ?? null, error: null };
        }
        return { data: null, error: null };
      },
      single: async () => {
        if (state.op === "insert" && state.insertRow) {
          const created = {
            id: `${table}-new`,
            created_at: "2026-10-11T12:00:00.000Z",
            updated_at: "2026-10-11T12:00:00.000Z",
            ...state.insertRow,
          };
          if (table === "walkthrough_sessions") db.sessions.push(created);
          if (table === "walkthrough_observations")
            db.observations.push(created);
          if (table === "walkthrough_follow_ups") db.followUps.push(created);
          return { data: created, error: null };
        }
        if (state.op === "update" && state.patch) {
          db.updates.push({
            table,
            filters: { ...state.filters },
            patch: state.patch,
          });
          const list =
            table === "walkthrough_sessions"
              ? db.sessions
              : table === "walkthrough_follow_ups"
                ? db.followUps
                : table === "walkthrough_observations"
                  ? db.observations
                  : null;
          if (!list) {
            return { data: null, error: { message: "unexpected update table" } };
          }
          const idx = list.findIndex((row) =>
            Object.entries(state.filters).every(
              ([k, v]) => String(row[k]) === String(v)
            )
          );
          if (idx < 0) {
            return { data: null, error: { message: "not found" } };
          }
          const next = { ...list[idx], ...state.patch };
          list[idx] = next;
          return { data: next, error: null };
        }
        return { data: null, error: { message: "unexpected single" } };
      },
    };

    return api;
  }

  return { from } as never;
}

function baseDb(overrides?: Partial<MockDb>): MockDb {
  return {
    specialists: [
      { id: "spec-a", store_number: "2587" },
      { id: "spec-b", store_number: "1852" },
    ],
    sections: [
      {
        id: "sec-a",
        store_id: "store-a",
        department_id: "d1",
        name: "Aisle 12",
        description: null,
        primary_owner_specialist_id: null,
        is_active: true,
        retired_at: null,
        created_at: "",
        updated_at: "",
      },
      {
        id: "sec-b",
        store_id: "store-b",
        department_id: "d2",
        name: "Foreign",
        description: null,
        primary_owner_specialist_id: null,
        is_active: true,
        retired_at: null,
        created_at: "",
        updated_at: "",
      },
    ],
    sessions: [
      {
        id: "sess-a",
        store_id: "store-a",
        status: "active",
        department_id: null,
        companion_specialist_id: null,
        focus_section_id: null,
        notes: null,
        started_at: "2026-10-11T10:00:00.000Z",
        ended_at: null,
        created_by_specialist_id: "op",
        created_at: "2026-10-11T10:00:00.000Z",
        updated_at: "2026-10-11T10:00:00.000Z",
      },
      {
        id: "sess-b",
        store_id: "store-b",
        status: "active",
        department_id: null,
        companion_specialist_id: null,
        focus_section_id: null,
        notes: null,
        started_at: "2026-10-11T10:00:00.000Z",
        ended_at: null,
        created_by_specialist_id: "op",
        created_at: "2026-10-11T10:00:00.000Z",
        updated_at: "2026-10-11T10:00:00.000Z",
      },
    ],
    observations: [
      {
        id: "obs-a",
        store_id: "store-a",
        session_id: "sess-a",
        observation_type: "general",
        body: "Local note",
        associate_specialist_id: null,
        section_id: null,
        department_id: null,
        aisle: null,
        bay: null,
        observed_at: "2026-10-11T10:05:00.000Z",
        created_by_specialist_id: "op",
        created_at: "2026-10-11T10:05:00.000Z",
        updated_at: "2026-10-11T10:05:00.000Z",
      },
      {
        id: "obs-b",
        store_id: "store-b",
        session_id: "sess-b",
        observation_type: "general",
        body: "Foreign note",
        associate_specialist_id: null,
        section_id: null,
        department_id: null,
        aisle: null,
        bay: null,
        observed_at: "2026-10-11T10:05:00.000Z",
        created_by_specialist_id: "op",
        created_at: "2026-10-11T10:05:00.000Z",
        updated_at: "2026-10-11T10:05:00.000Z",
      },
    ],
    followUps: [
      {
        id: "fu-a",
        store_id: "store-a",
        observation_id: "obs-a",
        session_id: "sess-a",
        action_text: "Face bay",
        responsible_specialist_id: null,
        due_on: null,
        status: "open",
        completion_evidence: null,
        resolution_notes: null,
        completed_at: null,
        completed_by_specialist_id: null,
        created_by_specialist_id: "op",
        created_at: "2026-10-11T10:06:00.000Z",
        updated_at: "2026-10-11T10:06:00.000Z",
      },
      {
        id: "fu-b",
        store_id: "store-b",
        observation_id: "obs-b",
        session_id: "sess-b",
        action_text: "Foreign action",
        responsible_specialist_id: null,
        due_on: null,
        status: "open",
        completion_evidence: null,
        resolution_notes: null,
        completed_at: null,
        completed_by_specialist_id: null,
        created_by_specialist_id: "op",
        created_at: "2026-10-11T10:06:00.000Z",
        updated_at: "2026-10-11T10:06:00.000Z",
      },
    ],
    touched: [],
    updates: [],
    inserts: [],
    ...overrides,
  };
}

describe("RD-5-FIX specialist / section store validation", () => {
  let db: MockDb;

  beforeEach(() => {
    db = baseDb();
  });

  it("accepts same-store specialist and rejects foreign/missing", async () => {
    const client = createMockSupabase(db);
    const ok = await assertRosterSpecialistForStore(client, {
      specialist_id: "spec-a",
      store_number: "2587",
    });
    expect(ok).toEqual({ ok: true, value: true });

    const foreign = await assertRosterSpecialistForStore(client, {
      specialist_id: "spec-b",
      store_number: "2587",
    });
    expect(foreign).toMatchObject({
      ok: false,
      code: "not_found",
      message: "Team member not found",
    });
    expect(String(foreign.ok === false ? foreign.message : "")).not.toMatch(
      /1852|store-b|foreign/i
    );

    const missing = await assertRosterSpecialistForStore(client, {
      specialist_id: "nope",
      store_number: "2587",
    });
    expect(missing).toMatchObject({ ok: false, code: "not_found" });

    const optional = await assertRosterSpecialistForStore(client, {
      specialist_id: null,
      store_number: "2587",
    });
    expect(optional).toEqual({ ok: true, value: true });
  });

  it("accepts same-store section and rejects foreign/missing", async () => {
    const client = createMockSupabase(db);
    const ok = await assertOperationalSectionForStore(client, {
      section_id: "sec-a",
      store_id: "store-a",
    });
    expect(ok).toEqual({ ok: true, value: true });

    const foreign = await assertOperationalSectionForStore(client, {
      section_id: "sec-b",
      store_id: "store-a",
    });
    expect(foreign).toMatchObject({
      ok: false,
      code: "not_found",
      message: "Section not found",
    });

    const optional = await assertOperationalSectionForStore(client, {
      section_id: "",
      store_id: "store-a",
    });
    expect(optional).toEqual({ ok: true, value: true });
  });

  it("startWalkthroughSession rejects foreign companion / focus section", async () => {
    const client = createMockSupabase(db);
    const badCompanion = await startWalkthroughSession(client, {
      store_id: "store-a",
      store_number: "2587",
      companion_specialist_id: "spec-b",
    });
    expect(badCompanion).toMatchObject({ ok: false, code: "not_found" });
    expect(db.inserts).toHaveLength(0);

    const badSection = await startWalkthroughSession(client, {
      store_id: "store-a",
      store_number: "2587",
      focus_section_id: "sec-b",
    });
    expect(badSection).toMatchObject({ ok: false, code: "not_found" });
    expect(db.inserts).toHaveLength(0);
  });

  it("startWalkthroughSession accepts same-store companion + section or nulls", async () => {
    const client = createMockSupabase(db);
    const withRefs = await startWalkthroughSession(client, {
      store_id: "store-a",
      store_number: "2587",
      companion_specialist_id: "spec-a",
      focus_section_id: "sec-a",
    });
    expect(withRefs.ok).toBe(true);
    expect(db.inserts.some((i) => i.table === "walkthrough_sessions")).toBe(
      true
    );

    const bare = await startWalkthroughSession(client, {
      store_id: "store-a",
      store_number: "2587",
    });
    expect(bare.ok).toBe(true);
  });

  it("createWalkthroughObservation rejects foreign session / associate / section", async () => {
    const client = createMockSupabase(db);

    const foreignSession = await createWalkthroughObservation(client, {
      store_id: "store-a",
      store_number: "2587",
      session_id: "sess-b",
      observation_type: "positive",
      body: "Good facing",
    });
    expect(foreignSession).toMatchObject({ ok: false, code: "not_found" });

    const foreignAssociate = await createWalkthroughObservation(client, {
      store_id: "store-a",
      store_number: "2587",
      session_id: "sess-a",
      observation_type: "positive",
      body: "Good facing",
      associate_specialist_id: "spec-b",
    });
    expect(foreignAssociate).toMatchObject({
      ok: false,
      code: "not_found",
      message: "Team member not found",
    });

    const foreignSection = await createWalkthroughObservation(client, {
      store_id: "store-a",
      store_number: "2587",
      session_id: "sess-a",
      observation_type: "opportunity",
      body: "Need packdown",
      section_id: "sec-b",
    });
    expect(foreignSection).toMatchObject({
      ok: false,
      code: "not_found",
      message: "Section not found",
    });
  });

  it("createWalkthroughObservation accepts same-store optional relationships", async () => {
    const client = createMockSupabase(db);
    const result = await createWalkthroughObservation(client, {
      store_id: "store-a",
      store_number: "2587",
      session_id: "sess-a",
      observation_type: "positive",
      body: "Recognition",
      associate_specialist_id: "spec-a",
      section_id: "sec-a",
    });
    expect(result.ok).toBe(true);
    expect(
      db.inserts.some((i) => i.table === "walkthrough_observations")
    ).toBe(true);

    const optional = await createWalkthroughObservation(client, {
      store_id: "store-a",
      store_number: "2587",
      session_id: "sess-a",
      observation_type: "general",
      body: "General note only",
    });
    expect(optional.ok).toBe(true);
  });

  it("foreign observation cannot create follow-up; foreign responsible rejected", async () => {
    const client = createMockSupabase(db);
    const foreignObs = await createWalkthroughFollowUp(client, {
      store_id: "store-a",
      store_number: "2587",
      observation_id: "obs-b",
      action_text: "Should fail",
    });
    expect(foreignObs).toMatchObject({ ok: false, code: "not_found" });
    expect(db.inserts.filter((i) => i.table === "walkthrough_follow_ups")).toHaveLength(
      0
    );

    const foreignResponsible = await createWalkthroughFollowUp(client, {
      store_id: "store-a",
      store_number: "2587",
      observation_id: "obs-a",
      action_text: "Re-face",
      responsible_specialist_id: "spec-b",
    });
    expect(foreignResponsible).toMatchObject({
      ok: false,
      code: "not_found",
      message: "Team member not found",
    });
  });

  it("same-store follow-up create succeeds with optional responsible", async () => {
    const client = createMockSupabase(db);
    const withPerson = await createWalkthroughFollowUp(client, {
      store_id: "store-a",
      store_number: "2587",
      observation_id: "obs-a",
      action_text: "Re-face bay 3",
      responsible_specialist_id: "spec-a",
    });
    expect(withPerson.ok).toBe(true);

    const optional = await createWalkthroughFollowUp(client, {
      store_id: "store-a",
      store_number: "2587",
      observation_id: "obs-a",
      action_text: "Operator owns it",
    });
    expect(optional.ok).toBe(true);
  });

  it("foreign session cannot be ended; foreign follow-up cannot be completed", async () => {
    const client = createMockSupabase(db);
    const endForeign = await endWalkthroughSession(client, {
      store_id: "store-a",
      session_id: "sess-b",
    });
    expect(endForeign).toMatchObject({ ok: false, code: "not_found" });
    expect(db.updates).toHaveLength(0);

    const completeForeign = await completeWalkthroughFollowUp(client, {
      store_id: "store-a",
      follow_up_id: "fu-b",
      completion_evidence: "Seen on floor",
    });
    expect(completeForeign).toMatchObject({ ok: false, code: "not_found" });
    expect(db.updates).toHaveLength(0);
  });
});

describe("RD-5-FIX follow-up completion independence", () => {
  it("requires evidence, updates only the follow-up, preserves observation, skips rotation/section tables", async () => {
    const db = baseDb();
    const observationBefore = { ...db.observations[0] };
    const client = createMockSupabase(db);

    const missingEvidence = await completeWalkthroughFollowUp(client, {
      store_id: "store-a",
      follow_up_id: "fu-a",
    });
    expect(missingEvidence).toMatchObject({ ok: false, code: "invalid" });
    expect(db.updates).toHaveLength(0);

    const done = await completeWalkthroughFollowUp(client, {
      store_id: "store-a",
      follow_up_id: "fu-a",
      completion_evidence: "Faced and tagged",
      resolution_notes: "Verified in aisle",
      completed_by_specialist_id: "op-1",
    });
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    expect(done.value.status).toBe("done");
    expect(done.value.completion_evidence).toBe("Faced and tagged");
    expect(done.value.completed_at).toBeTruthy();

    expect(db.observations[0]).toEqual(observationBefore);

    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]?.table).toBe("walkthrough_follow_ups");
    expect(db.updates[0]?.filters).toMatchObject({
      id: "fu-a",
      store_id: "store-a",
    });

    const forbidden = [
      "weekly_rotations",
      "sunday_bay_assignments",
      "operational_sections",
      "operational_section_members",
      "operational_section_events",
      "walkthrough_observations",
      "walkthrough_sessions",
    ];
    for (const table of forbidden) {
      expect(db.touched).not.toContain(table);
      expect(db.updates.some((u) => u.table === table)).toBe(false);
      expect(db.inserts.some((i) => i.table === table)).toBe(false);
    }
  });
});
