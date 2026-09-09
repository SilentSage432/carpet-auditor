/**
 * ROSTER-EDIT-001 — editing a roster member's workforce details.
 *
 * Field evidence (Samsung, live roster setup): a member's information was
 * wrong and the only available correction was Delete → Recreate, because
 * SpecialistEditSheet showed name, phone, and job title as read-only text.
 *
 * PATCH /api/roster/members/[id] corrects workforce description only. Authority
 * — role, accessible_departments, PIN, tokens, auth identity — is refused here
 * and stays with the surfaces that own it (ROSTER-ROLE-001).
 *
 * Home department is deliberately NOT editable: accessible_departments stores
 * the home department alongside granted extras in one flat array, so a move
 * cannot tell a stale home from a deliberate grant. See the tranche report.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTtlCache } from "@/lib/store-ops/ttl-cache";

const hoisted = vi.hoisted(() => ({
  actor: null as unknown,
  supabase: null as unknown,
}));

vi.mock("@/lib/store-ops/auth-server", async () => {
  // Real guards, stubbed actor resolution — RBAC logic under test stays genuine.
  const real = await import("@/lib/store-ops/auth");
  return { ...real, resolveStoreOpsActor: async () => hoisted.actor };
});

vi.mock("@/lib/supabase/admin-response", () => ({
  requireSupabaseAdmin: () => ({ supabase: hoisted.supabase, response: null }),
}));

const { PATCH } = await import("@/app/api/roster/members/[id]/route");

type Row = Record<string, unknown>;

function readRepo(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

/** Minimal PostgREST stand-in: select/update by filters, thenable like the real builder. */
function fakeSupabase(
  rows: Row[],
  options: {
    updateError?: { code?: string; message: string };
    readError?: { message: string };
    /** Stands in for a database-side transform, proving read-back is real. */
    onWrite?: (row: Row) => void;
  } = {}
) {
  const writes: { patch: Row; filters: Row }[] = [];
  const forbidden: string[] = [];

  function from() {
    const filters: Row = {};
    let patch: Row = {};
    let mode: "select" | "update" = "select";

    const match = () =>
      rows.find((row) =>
        Object.entries(filters).every(([key, value]) => row[key] === value)
      );

    const api = {
      select: () => ((mode = "select"), api),
      update: (next: Row) => ((mode = "update"), (patch = next), api),
      // Identity must be the immutable id — never name.
      upsert: () => {
        forbidden.push("upsert");
        return api;
      },
      insert: () => {
        forbidden.push("insert");
        return api;
      },
      delete: () => {
        forbidden.push("delete");
        return api;
      },
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return api;
      },
      maybeSingle: () => {
        if (options.readError && mode === "select" && writes.length > 0) {
          return Promise.resolve({ data: null, error: options.readError });
        }
        return Promise.resolve({ data: match() ?? null, error: null });
      },
      then: (onFulfilled: (value: unknown) => unknown) => {
        if (mode === "update") {
          if (options.updateError) {
            return Promise.resolve({
              data: null,
              error: options.updateError,
            }).then(onFulfilled);
          }
          const target = match();
          writes.push({ patch: { ...patch }, filters: { ...filters } });
          if (target) {
            Object.assign(target, patch);
            options.onWrite?.(target);
          }
        }
        return Promise.resolve({ data: null, error: null }).then(onFulfilled);
      },
    };
    return api;
  }

  return { from, writes, forbidden, rows };
}

function associateRow(overrides: Row = {}): Row {
  return {
    id: "member-1",
    store_number: "2587",
    name: "Jhon Smith",
    role: "Associate",
    floor_title: "CSA",
    phone_number: null,
    assigned_department: "flooring",
    home_department: "flooring",
    accessible_departments: ["flooring"],
    pin_code: "1234",
    is_active: true,
    ...overrides,
  };
}

const SUPER_ADMIN = {
  userId: "u-1",
  specialistId: "s-1",
  role: "super_admin",
  departmentCode: null,
  accessibleDepartmentCodes: [],
  storeNumber: "2587",
};

const SUPERVISOR = { ...SUPER_ADMIN, role: "department_supervisor" };

async function patch(
  body: Row,
  id = "member-1"
): Promise<{ status: number; json: Record<string, unknown> }> {
  const request = new Request(`http://localhost/api/roster/members/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await PATCH(request, { params: Promise.resolve({ id }) });
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

beforeEach(() => {
  hoisted.actor = SUPER_ADMIN;
  hoisted.supabase = null;
});

describe("ROSTER-EDIT-001 correcting workforce details", () => {
  it("saves a name correction against the existing row", async () => {
    const db = fakeSupabase([associateRow()]);
    hoisted.supabase = db;

    const { status, json } = await patch({ name: "John Smith" });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect((json.specialist as Row).name).toBe("John Smith");
    expect(db.rows[0].name).toBe("John Smith");
  });

  it("a rename updates by immutable id and store scope — it never inserts", async () => {
    const db = fakeSupabase([associateRow()]);
    hoisted.supabase = db;

    await patch({ name: "John Smith" });

    // This is the ROSTER-LIFE-001 hazard: upsert on store_number,name would
    // have created a second member instead of correcting this one.
    expect(db.forbidden).toEqual([]);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0].filters).toEqual({ id: "member-1", store_number: "2587" });
    expect(db.writes[0].patch).not.toHaveProperty("name", "Jhon Smith");
    expect(db.rows).toHaveLength(1);
  });

  it("rejects an empty name rather than blanking the member", async () => {
    const db = fakeSupabase([associateRow()]);
    hoisted.supabase = db;

    const { status, json } = await patch({ name: "   " });

    expect(status).toBe(400);
    expect(json.error).toBe("Enter a name");
    expect(db.writes).toHaveLength(0);
    expect(db.rows[0].name).toBe("Jhon Smith");
  });

  it("normalizes and persists a phone number", async () => {
    const db = fakeSupabase([associateRow()]);
    hoisted.supabase = db;

    const { status, json } = await patch({ phone: "(555) 123-4567" });

    expect(status).toBe(200);
    expect((json.specialist as Row).phone_number).toBe("+15551234567");
    expect(db.rows[0].phone_number).toBe("+15551234567");
  });

  it("allows clearing the phone number", async () => {
    const db = fakeSupabase([associateRow({ phone_number: "+15551234567" })]);
    hoisted.supabase = db;

    const { status } = await patch({ phone: "" });

    expect(status).toBe(200);
    expect(db.rows[0].phone_number).toBeNull();
  });

  it("rejects an unparseable phone number", async () => {
    const db = fakeSupabase([associateRow()]);
    hoisted.supabase = db;

    const { status, json } = await patch({ phone: "12" });

    expect(status).toBe(400);
    expect(json.error).toBe("Enter a valid phone number");
    expect(db.writes).toHaveLength(0);
  });

  it("persists a supported job title without touching role", async () => {
    const db = fakeSupabase([associateRow()]);
    hoisted.supabase = db;

    const { status, json } = await patch({ floor_title: "Specialist" });

    expect(status).toBe(200);
    expect((json.specialist as Row).floor_title).toBe("Specialist");
    // Workforce description only — authority is untouched.
    expect(db.writes[0].patch).not.toHaveProperty("role");
    expect(db.rows[0].role).toBe("Associate");
  });

  it("rejects a job title that is not in the canonical option set", async () => {
    const db = fakeSupabase([associateRow()]);
    hoisted.supabase = db;

    const { status, json } = await patch({ floor_title: "Regional Director" });

    expect(status).toBe(400);
    expect(json.error).toBe("Unknown job title");
    expect(db.writes).toHaveLength(0);
  });

  it("refuses a job title on a supervisor, where creation stores null", async () => {
    const db = fakeSupabase([associateRow({ role: "Supervisor", floor_title: null })]);
    hoisted.supabase = db;

    const { status, json } = await patch({ floor_title: "CSA" });

    expect(status).toBe(400);
    expect(json.error).toBe("Job title applies to associates only");
    expect(db.writes).toHaveLength(0);
  });

  it("returns the persisted row, not the requested values", async () => {
    // A database-side transform stands in for any trigger or coercion.
    const db = fakeSupabase([associateRow()], {
      onWrite: (row) => {
        row.name = String(row.name).toUpperCase();
      },
    });
    hoisted.supabase = db;

    const { json } = await patch({ name: "John Smith" });

    expect((json.specialist as Row).name).toBe("JOHN SMITH");
  });

  it("rejects a no-op patch instead of reporting a save", async () => {
    const db = fakeSupabase([associateRow()]);
    hoisted.supabase = db;

    const { status, json } = await patch({});

    expect(status).toBe(400);
    expect(json.error).toBe("No changes supplied");
    expect(db.writes).toHaveLength(0);
  });
});

describe("ROSTER-EDIT-001 authority cannot travel through this route", () => {
  it.each([
    ["role", { role: "MasterAdmin" }],
    ["accessible_departments", { accessible_departments: ["flooring", "paint"] }],
    ["pin_code", { pin_code: "0000" }],
    ["pin", { pin: "0000" }],
    ["invite_token_hash", { invite_token_hash: "abc" }],
    ["auth_user_id", { auth_user_id: "u-9" }],
    ["username", { username: "someone-else" }],
    ["is_active", { is_active: false }],
    ["store_number", { store_number: "9999" }],
    // Deferred until the home/access interaction has a decided contract.
    ["department", { department: "paint" }],
    ["home_department", { home_department: "paint" }],
    ["assigned_department", { assigned_department: "paint" }],
  ])("refuses %s outright", async (field, body) => {
    const db = fakeSupabase([associateRow()]);
    hoisted.supabase = db;

    const { status, json } = await patch(body as Row);

    expect(status).toBe(400);
    expect(String(json.error)).toContain(field);
    expect(db.writes).toHaveLength(0);
  });

  it("refuses an escalation even when smuggled beside a valid edit", async () => {
    const db = fakeSupabase([associateRow()]);
    hoisted.supabase = db;

    const { status } = await patch({ name: "John Smith", role: "MasterAdmin" });

    expect(status).toBe(400);
    // The legitimate half must not land either.
    expect(db.writes).toHaveLength(0);
    expect(db.rows[0].name).toBe("Jhon Smith");
    expect(db.rows[0].role).toBe("Associate");
  });
});

describe("ROSTER-EDIT-001 authorization is enforced on the server", () => {
  it("rejects a missing session", async () => {
    hoisted.actor = null;
    hoisted.supabase = fakeSupabase([associateRow()]);

    const { status } = await patch({ name: "John Smith" });

    expect(status).toBe(401);
  });

  it("rejects an associate actor", async () => {
    hoisted.actor = { ...SUPER_ADMIN, role: "associate" };
    const db = fakeSupabase([associateRow()]);
    hoisted.supabase = db;

    const { status } = await patch({ name: "John Smith" });

    expect(status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("rejects a target in another store", async () => {
    const db = fakeSupabase([associateRow({ store_number: "1234" })]);
    hoisted.supabase = db;

    const { status, json } = await patch({ name: "John Smith" });

    expect(status).toBe(404);
    expect(json.error).toBe("Roster member not found");
    expect(db.writes).toHaveLength(0);
  });

  it("protects a Master Admin identity from any actor", async () => {
    const db = fakeSupabase([associateRow({ role: "MasterAdmin" })]);
    hoisted.supabase = db;

    const { status } = await patch({ name: "John Smith" });

    expect(status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("a supervisor may correct an associate", async () => {
    hoisted.actor = SUPERVISOR;
    const db = fakeSupabase([associateRow()]);
    hoisted.supabase = db;

    const { status } = await patch({ name: "John Smith" });

    expect(status).toBe(200);
  });

  it("a supervisor may not correct another supervisor", async () => {
    hoisted.actor = SUPERVISOR;
    const db = fakeSupabase([associateRow({ role: "Supervisor" })]);
    hoisted.supabase = db;

    const { status, json } = await patch({ name: "John Smith" });

    expect(status).toBe(403);
    expect(json.error).toBe("Supervisors may only edit associates");
    expect(db.writes).toHaveLength(0);
  });
});

describe("ROSTER-EDIT-001 a failed save is never reported as success", () => {
  it("surfaces a write failure", async () => {
    hoisted.supabase = fakeSupabase([associateRow()], {
      updateError: { message: "permission denied" },
    });

    const { status, json } = await patch({ name: "John Smith" });

    expect(status).toBe(500);
    expect(json.ok).toBeUndefined();
    expect(json.specialist).toBeUndefined();
  });

  it("reports a duplicate name as a conflict rather than a silent overwrite", async () => {
    hoisted.supabase = fakeSupabase([associateRow()], {
      updateError: { code: "23505", message: "duplicate key value" },
    });

    const { status, json } = await patch({ name: "Existing Member" });

    expect(status).toBe(409);
    expect(String(json.error)).toContain("already uses that name");
  });

  it("does not claim success when the row cannot be read back", async () => {
    hoisted.supabase = fakeSupabase([associateRow()], {
      readError: { message: "read failed" },
    });

    const { status, json } = await patch({ name: "John Smith" });

    expect(status).toBe(500);
    expect(json.ok).toBeUndefined();
  });
});

describe("ROSTER-EDIT-001 the edit survives the roster cache", () => {
  it("reproduces the stale-TTL defect the client must avoid", async () => {
    const cache = createTtlCache<string>(45_000);
    let dbValue = "Jhon Smith";
    const load = async () => dbValue;

    expect(await cache.getSWR("roster:2587", load)).toBe("Jhon Smith");
    dbValue = "John Smith";
    // Without invalidation the corrected name visibly reverts.
    expect(await cache.getSWR("roster:2587", load)).toBe("Jhon Smith");

    cache.invalidate();
    expect(await cache.getSWR("roster:2587", load)).toBe("John Smith");
  });

  it("updateMemberWorkforceDetails drops the roster cache before returning", () => {
    const client = readRepo("lib/store-ops/client.ts");
    const start = client.indexOf(
      "export async function updateMemberWorkforceDetails("
    );
    expect(start).toBeGreaterThan(-1);
    const next = client.indexOf("\nexport ", start + 1);
    const body = client.slice(start, next === -1 ? client.length : next);

    expect(body).toContain("invalidateRosterCache()");
    expect(body).toContain("invalidateStoreOpsListCaches()");
    // Truthful read-back: the persisted row is mapped, not the request.
    expect(body).toContain("mapRow(data.specialist)");
    expect(body).toContain('method: "PATCH"');
  });
});

describe("ROSTER-EDIT-001 the editor surface", () => {
  const sheet = readRepo("components/hub/SpecialistEditSheet.tsx");

  it("offers a discoverable Edit details affordance", () => {
    expect(sheet).toContain("Edit details");
    expect(sheet).toContain("Member details");
    expect(sheet).toContain("openDetails");
  });

  it("edits only the four workforce inputs", () => {
    expect(sheet).toContain("setNameDraft");
    expect(sheet).toContain("setPhoneDraft");
    expect(sheet).toContain("ROSTER_FLOOR_TITLES.map");
    // Home department stays read-only pending the access decision.
    expect(sheet).not.toContain("setHomeDraft");
    expect(sheet).not.toContain("DepartmentPicker");
  });

  it("keeps a failed save open with the entered values", () => {
    const start = sheet.indexOf("async function handleSaveDetails()");
    const body = sheet.slice(start, sheet.indexOf("\n  }\n", start));
    expect(body).toContain("setDetailsError(message)");
    expect(body).toContain("toastError(message)");
    // Success and close only after the await resolves.
    expect(body.indexOf("await updateMemberWorkforceDetails")).toBeLessThan(
      body.indexOf("toastSuccess")
    );
    expect(body.indexOf("toastSuccess")).toBeLessThan(
      body.indexOf("onDetailsSaved()")
    );
  });

  it("does not reuse the unsafe rename writers from ROSTER-LIFE-001", () => {
    expect(sheet).not.toContain("saveSpecialist");
    expect(sheet).not.toContain("updateSpecialistScope");
  });

  it("keeps authority actions visually separate from workforce editing", () => {
    expect(sheet).toContain("Administrative actions");
    expect(sheet).toContain("DepartmentAccessChips");
    expect(sheet).toContain("Remove Specialist");
    // UX-005G occupancy is still owned by the sheet.
    expect(sheet).toContain("useFocusedWorkspace()");
  });

  it("the roster reloads through the existing flow after a save", () => {
    const roster = readRepo("components/hub/tabs/RosterTab.tsx");
    expect(roster).toContain("onDetailsSaved={() => void reload()}");
  });
});

describe("ROSTER-EDIT-001 leaves member creation alone", () => {
  it("Add Team Member still resolves job and role together at creation", () => {
    const roster = readRepo("components/hub/tabs/RosterTab.tsx");
    expect(roster).toContain("resolveRosterJobSave(jobOptionId, department)");
    expect(roster).toContain("floor_title: job.floor_title");
    // UX-005G.1 suppression stays wired.
    expect(roster).toContain("useFocusedWorkspace()");
  });

  it("no migration accompanies this tranche", () => {
    const route = readRepo("app/api/roster/members/[id]/route.ts");
    expect(route).toContain("store_specialists");
    expect(route).not.toContain("alter table");
  });
});
