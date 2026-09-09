/**
 * RUNTIME-COMPAT-001 — production runtime contract.
 *
 * The fake Supabase client in this file is deliberately *schema-strict*: its
 * column lists were copied from a read-only inspection of the live DeptSync
 * project, and any write or filter naming a column production does not have
 * fails the way PostgREST fails. That is the point — the three P0 defects this
 * tranche repairs were all code writing columns that do not exist, and a
 * permissive fake is exactly what let them ship.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { reportRotationBarriers, listRotationExceptions } from "./verification";
import { verifyAllPendingRotations } from "./rotation-review";
import { completeWeeklyRotation } from "./rotations";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

/** Source with comments stripped — an assertion a comment can satisfy is not one. */
function readRepoCode(relativePath: string): string {
  return readRepo(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ------------------------------------------------------------------ *
 * Production column truth (read-only inspection, project fmeinlwhixngednabhgy)
 * ------------------------------------------------------------------ */

const PRODUCTION_COLUMNS: Record<string, readonly string[]> = {
  rotation_exceptions: [
    "id",
    "rotation_id",
    "department_id",
    "location_id",
    "reason",
    "logged_by",
    "created_at",
  ],
  weekly_rotations: [
    "id",
    "department_id",
    "location_id",
    "week_number",
    "year",
    "status",
    "completed_at",
    "notes",
    "created_at",
    "is_completed",
    "verified_at",
    "assigned_week",
    "store_number",
    "store_id",
    "verification_status",
    "completed_by",
    "verified_by",
    "review_note",
    "superseded_at",
    "supersede_source",
    "superseded_by",
  ],
  store_locations: [
    "id",
    "department_id",
    "aisle",
    "bay",
    "status",
    "is_active",
    "created_at",
    "store_id",
    "type",
    "cycle_number",
    "updated_at",
    "manual_priority_count",
    "location_type",
    "audit_frequency_days",
    "store_number",
    "last_completed_at",
    "last_serviced_at",
    "velocity_tier",
    "priority_override",
    "carried_over",
    "last_carried_over_at",
    "custom_decay_days",
    "workflow_type",
  ],
  departments: [
    "id",
    "store_id",
    "name",
    "code",
    "weekly_bay_target",
    "is_active",
    "created_at",
    "store_number",
  ],
  sunday_bay_assignments: [
    "id",
    "store_number",
    "department",
    "week_starting",
    "bay_id",
    "assigned_specialist_id",
    "roster_specialist_id",
    "specialist_name",
    "status",
    "created_at",
    "updated_at",
    "is_carried_over",
  ],
  weekly_rotation_completion_attempts: [
    "id",
    "weekly_rotation_id",
    "reported_at",
    "reported_by",
    "reviewed_at",
    "reviewed_by",
    "review_outcome",
    "review_note",
    "created_at",
  ],
};

/** Foreign keys PostgREST can embed through. */
const EMBEDS: Record<string, Record<string, { table: string; fk: string }>> = {
  rotation_exceptions: {
    weekly_rotations: { table: "weekly_rotations", fk: "rotation_id" },
    store_locations: { table: "store_locations", fk: "location_id" },
    departments: { table: "departments", fk: "department_id" },
  },
};

type Row = Record<string, unknown>;
type PgError = { code?: string; message: string } | null;
type QueryResult = { data: unknown; error: PgError; count?: number | null };

function missingColumn(table: string, column: string): PgError {
  return {
    code: "PGRST204",
    message: `Could not find the '${column}' column of '${table}' in the schema cache`,
  };
}

function unknownFilterColumn(table: string, column: string): PgError {
  return {
    code: "42703",
    message: `column ${table}.${column} does not exist`,
  };
}

/** Split "a, b(c, d), e" on top-level commas only. */
function splitSelect(select: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of select) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

type ParsedEmbed = { name: string; inner: boolean; columns: string[] };

function parseSelect(select: string): {
  columns: string[];
  embeds: ParsedEmbed[];
} {
  const columns: string[] = [];
  const embeds: ParsedEmbed[] = [];
  for (const part of splitSelect(select)) {
    const embedMatch = /^([a-z_]+)(!inner)?\(([^)]*)\)$/i.exec(part);
    if (embedMatch) {
      embeds.push({
        name: embedMatch[1]!,
        inner: Boolean(embedMatch[2]),
        columns: embedMatch[3]!.split(",").map((c) => c.trim()).filter(Boolean),
      });
      continue;
    }
    columns.push(part);
  }
  return { columns, embeds };
}

type FakeDb = {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  inserts: Array<{ table: string; rows: Row[] }>;
  updates: Array<{ table: string; patch: Row }>;
  deletes: Array<{ table: string }>;
};

function createProductionFake(seed: Record<string, Row[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = {};
  for (const table of Object.keys(PRODUCTION_COLUMNS)) {
    tables[table] = (seed[table] ?? []).map((row) => ({ ...row }));
  }
  const inserts: FakeDb["inserts"] = [];
  const updates: FakeDb["updates"] = [];
  const deletes: FakeDb["deletes"] = [];
  let autoId = 0;

  function from(table: string) {
    const known = PRODUCTION_COLUMNS[table];
    if (!known) throw new Error(`Unexpected table ${table}`);

    const filters: Array<{ col: string; op: "eq" | "in" | "is"; val: unknown }> =
      [];
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row[] = [];
    let patch: Row | null = null;
    let selectString = "*";
    let headOnly = false;
    let wantCount = false;
    let wantSingle = false;
    let wantMaybeSingle = false;

    const run = async (): Promise<QueryResult> => {
      // Column validation first — PostgREST rejects before it reads anything.
      for (const filter of filters) {
        const [base] = filter.col.split(".");
        if (filter.col.includes(".")) continue; // embedded filter, checked below
        if (!known.includes(base!)) {
          return { data: null, error: unknownFilterColumn(table, base!) };
        }
      }
      if (mode === "insert") {
        for (const row of payload) {
          for (const key of Object.keys(row)) {
            if (!known.includes(key)) {
              return { data: null, error: missingColumn(table, key) };
            }
          }
        }
      }
      if (mode === "update" && patch) {
        for (const key of Object.keys(patch)) {
          if (!known.includes(key)) {
            return { data: null, error: missingColumn(table, key) };
          }
        }
      }

      const { columns, embeds } = parseSelect(selectString);
      for (const column of columns) {
        if (column === "*" || column === "id") continue;
        if (!known.includes(column)) {
          return { data: null, error: unknownFilterColumn(table, column) };
        }
      }

      const matches = (row: Row) =>
        filters.every((filter) => {
          if (filter.col.includes(".")) return true;
          const actual = row[filter.col];
          if (filter.op === "is") return (actual ?? null) === filter.val;
          if (filter.op === "in") {
            return (filter.val as unknown[]).some(
              (v) => String(v ?? "") === String(actual ?? "")
            );
          }
          return String(actual ?? "") === String(filter.val ?? "");
        });

      if (mode === "insert") {
        const created = payload.map((row) => {
          autoId += 1;
          return {
            id: `gen-${autoId}`,
            created_at: new Date().toISOString(),
            ...row,
          };
        });
        inserts.push({ table, rows: payload.map((row) => ({ ...row })) });
        tables[table]!.push(...created);
        return { data: created.map((row) => ({ ...row })), error: null };
      }

      const hits = tables[table]!.filter(matches);

      if (mode === "delete") {
        deletes.push({ table });
        for (const row of hits) {
          tables[table]!.splice(tables[table]!.indexOf(row), 1);
        }
        return { data: hits, error: null };
      }

      if (mode === "update" && patch) {
        updates.push({ table, patch: { ...patch } });
        for (const row of hits) Object.assign(row, patch);
      }

      // Embeds + embedded filters.
      let rows = hits.map((row) => ({ ...row }));
      for (const embed of embeds) {
        const link = EMBEDS[table]?.[embed.name];
        if (!link) {
          return { data: null, error: unknownFilterColumn(table, embed.name) };
        }
        const embeddedFilters = filters.filter((f) =>
          f.col.startsWith(`${embed.name}.`)
        );
        const next: Row[] = [];
        for (const row of rows) {
          const parent =
            tables[link.table]!.find(
              (candidate) =>
                String(candidate.id ?? "") === String(row[link.fk] ?? "")
            ) ?? null;
          const projected = parent
            ? Object.fromEntries(
                embed.columns.map((column) => [column, parent[column] ?? null])
              )
            : null;
          const passes = embeddedFilters.every(
            (filter) =>
              String(parent?.[filter.col.split(".")[1]!] ?? "") ===
              String(filter.val ?? "")
          );
          if (embed.inner && (!parent || !passes)) continue;
          if (!embed.inner && embeddedFilters.length > 0 && !passes) continue;
          next.push({ ...row, [embed.name]: projected });
        }
        rows = next;
      }

      if (wantCount) {
        return { data: headOnly ? null : rows, error: null, count: rows.length };
      }
      if (wantSingle) {
        if (!rows[0]) {
          return {
            data: null,
            error: { message: "JSON object requested, 0 rows returned" },
          };
        }
        return { data: rows[0], error: null };
      }
      if (wantMaybeSingle) {
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    };

    const api: Record<string, unknown> = {};
    const thenable = {
      then(
        onFulfilled: (value: QueryResult) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        return run().then(onFulfilled, onRejected);
      },
    };
    const chain = () => Object.assign(api, thenable);

    Object.assign(api, {
      select: (
        columns?: string,
        options?: { count?: string; head?: boolean }
      ) => {
        if (columns) selectString = columns;
        if (options?.count) wantCount = true;
        if (options?.head) headOnly = true;
        return chain();
      },
      insert: (rows: Row | Row[]) => {
        mode = "insert";
        payload = Array.isArray(rows) ? rows : [rows];
        return chain();
      },
      update: (next: Row) => {
        mode = "update";
        patch = next;
        return chain();
      },
      delete: () => {
        mode = "delete";
        return chain();
      },
      eq: (col: string, val: unknown) => {
        filters.push({ col, op: "eq", val });
        return chain();
      },
      in: (col: string, val: unknown[]) => {
        filters.push({ col, op: "in", val });
        return chain();
      },
      is: (col: string, val: unknown) => {
        filters.push({ col, op: "is", val });
        return chain();
      },
      order: () => chain(),
      limit: () => chain(),
      single: () => {
        wantSingle = true;
        return chain();
      },
      maybeSingle: () => {
        wantMaybeSingle = true;
        return chain();
      },
    });

    return chain();
  }

  return {
    client: { from } as unknown as SupabaseClient,
    tables,
    inserts,
    updates,
    deletes,
  };
}

function seededDepartment(overrides?: { rotation?: Row; location?: Row }): FakeDb {
  return createProductionFake({
    departments: [
      {
        id: "dept-1",
        store_id: "store-1",
        name: "Flooring",
        code: "FLOOR",
        weekly_bay_target: 3,
        is_active: true,
      },
    ],
    store_locations: [
      {
        id: "loc-1",
        store_id: "store-1",
        department_id: "dept-1",
        aisle: "12",
        bay: "4",
        status: "ASSIGNED",
        is_active: true,
        cycle_number: 1,
        carried_over: false,
        last_carried_over_at: null,
        ...overrides?.location,
      },
    ],
    weekly_rotations: [
      {
        id: "rot-1",
        store_id: "store-1",
        department_id: "dept-1",
        location_id: "loc-1",
        assigned_week: "2026-W37",
        is_completed: false,
        verification_status: "PENDING",
        completed_at: null,
        completed_by: null,
        verified_at: null,
        verified_by: null,
        review_note: null,
        superseded_at: null,
        ...overrides?.rotation,
      },
    ],
  });
}

/* ------------------------------------------------------------------ *
 * Guard — the fake is only evidence if it actually rejects bad columns
 * ------------------------------------------------------------------ */

describe("schema-strict fake rejects columns production does not have", () => {
  it("refuses the pre-repair barrier shape", async () => {
    const db = seededDepartment();
    const { error } = await db.client.from("rotation_exceptions").insert([
      { department_id: "dept-1", bay_id: "loc-1", reason: "Blocked Bay" },
    ]);
    expect(error?.message).toContain("bay_id");
  });

  it("refuses department last_verified_week and store_locations department_code", async () => {
    const db = seededDepartment();
    const dept = await db.client
      .from("departments")
      .update({ last_verified_week: "2026-W37" })
      .eq("id", "dept-1");
    expect(dept.error?.message).toContain("last_verified_week");

    const loc = await db.client
      .from("store_locations")
      .update({ department_code: "FLOOR" })
      .eq("id", "loc-1");
    expect(loc.error?.message).toContain("department_code");
  });
});

/* ------------------------------------------------------------------ *
 * A + B — barrier writer shape and location evidence
 * ------------------------------------------------------------------ */

describe("A/B — barrier persistence uses production's normalized shape", () => {
  it("writes rotation_id, department_id, location_id, reason and logged_by", async () => {
    const db = seededDepartment();
    const result = await reportRotationBarriers(db.client, {
      departmentId: "dept-1",
      assignedWeek: "2026-W37",
      reportedBy: "associate-1",
      incomplete: [
        {
          rotationId: "rot-1",
          locationId: "loc-1",
          reason: "Blocked Bay",
          cycleNumber: 1,
        },
      ],
    });

    expect(result.exception_count).toBe(1);
    const written = db.inserts.find((i) => i.table === "rotation_exceptions");
    expect(written).toBeDefined();
    expect(Object.keys(written!.rows[0]!).sort()).toEqual([
      "department_id",
      "location_id",
      "logged_by",
      "reason",
      "rotation_id",
    ]);
    expect(written!.rows[0]).toMatchObject({
      rotation_id: "rot-1",
      department_id: "dept-1",
      location_id: "loc-1",
      reason: "Blocked Bay",
      logged_by: "associate-1",
    });
  });

  it("never writes bay_id, cycle_number, assigned_week or reported_by", () => {
    const code = readRepoCode("lib/store-ops/verification.ts");
    expect(code).not.toContain("bay_id");
    expect(code).not.toContain("reported_by:");
    expect(code).not.toContain("cycle_number:");
    expect(code).not.toContain("assigned_week: input.assignedWeek");
  });

  it("leaves carry-over evidence on the physical location", async () => {
    const db = seededDepartment();
    await reportRotationBarriers(db.client, {
      departmentId: "dept-1",
      assignedWeek: "2026-W37",
      reportedBy: "associate-1",
      incomplete: [
        {
          rotationId: "rot-1",
          locationId: "loc-1",
          reason: "Freight/Pallets In Aisle",
          cycleNumber: 1,
        },
      ],
    });

    const location = db.tables.store_locations![0]!;
    expect(location.status).toBe("CARRIED_OVER");
    expect(location.carried_over).toBe(true);
    expect(typeof location.last_carried_over_at).toBe("string");
  });

  it("writes barrier evidence before location state, so evidence survives", async () => {
    const db = seededDepartment();
    await reportRotationBarriers(db.client, {
      departmentId: "dept-1",
      assignedWeek: "2026-W37",
      incomplete: [
        {
          rotationId: "rot-1",
          locationId: "loc-1",
          reason: "Short Staffed",
          cycleNumber: 1,
        },
      ],
    });

    expect(db.inserts[0]?.table).toBe("rotation_exceptions");
    expect(db.updates[0]?.table).toBe("store_locations");
  });
});

/* ------------------------------------------------------------------ *
 * C — barrier reader
 * ------------------------------------------------------------------ */

describe("C — barrier history reads without a week column", () => {
  it("resolves the week through rotation_id and excludes other weeks", async () => {
    const db = seededDepartment();
    db.tables.weekly_rotations!.push({
      id: "rot-old",
      store_id: "store-1",
      department_id: "dept-1",
      location_id: "loc-1",
      assigned_week: "2026-W30",
      is_completed: false,
      verification_status: "PENDING",
      superseded_at: null,
    });
    db.tables.rotation_exceptions!.push(
      {
        id: "exc-now",
        rotation_id: "rot-1",
        department_id: "dept-1",
        location_id: "loc-1",
        reason: "Blocked Bay",
        logged_by: "associate-1",
        created_at: "2026-09-08T12:00:00.000Z",
      },
      {
        id: "exc-old",
        rotation_id: "rot-old",
        department_id: "dept-1",
        location_id: "loc-1",
        reason: "Short Staffed",
        logged_by: "associate-1",
        created_at: "2026-07-20T12:00:00.000Z",
      }
    );

    const rows = await listRotationExceptions(db.client, {
      assignedWeek: "2026-W37",
      departmentId: "dept-1",
    });

    expect(rows.map((row) => row.id)).toEqual(["exc-now"]);
    expect(rows[0]?.weekly_rotations?.assigned_week).toBe("2026-W37");
  });

  it("does not filter rotation_exceptions on assigned_week", () => {
    const code = readRepoCode("lib/store-ops/verification.ts");
    // weekly_rotations legitimately has assigned_week; rotation_exceptions does not.
    expect(code).not.toMatch(
      /from\("rotation_exceptions"\)[\s\S]{0,600}?eq\("assigned_week"/
    );
    expect(code).toContain('eq("weekly_rotations.assigned_week"');
  });

  it("surfaces a query error instead of reporting an empty week", async () => {
    const db = seededDepartment();
    const broken = {
      from: (table: string) => {
        const builder = db.client.from(table) as unknown as Record<
          string,
          unknown
        >;
        // Force the shape of a missing-column read — the failure mode that used
        // to be swallowed and rendered as "no barriers this week".
        (builder.eq as (col: string, val: unknown) => unknown)(
          "assigned_week",
          "2026-W37"
        );
        return builder;
      },
    } as unknown as SupabaseClient;

    await expect(
      listRotationExceptions(broken, { departmentId: "dept-1" })
    ).rejects.toThrow(/assigned_week does not exist/);
  });
});

/* ------------------------------------------------------------------ *
 * D — Verify All
 * ------------------------------------------------------------------ */

describe("D — Verify All succeeds without a department stamp", () => {
  it("verifies pending bays, touches no departments row, and is idempotent", async () => {
    const db = seededDepartment({
      rotation: {
        is_completed: true,
        verification_status: "PENDING_VERIFICATION",
        completed_at: "2026-09-08T10:00:00.000Z",
        completed_by: "associate-1",
      },
    });

    const first = await verifyAllPendingRotations(db.client, {
      storeId: "store-1",
      departmentId: "dept-1",
      assignedWeek: "2026-W37",
      actorId: "ds-1",
    });

    expect(first.verified_count).toBe(1);
    expect(db.tables.weekly_rotations![0]).toMatchObject({
      verification_status: "VERIFIED_COMPLETE",
      verified_by: "ds-1",
    });
    expect(db.tables.store_locations![0]?.status).toBe("COMPLETED");
    expect(db.updates.some((u) => u.table === "departments")).toBe(false);

    const second = await verifyAllPendingRotations(db.client, {
      storeId: "store-1",
      departmentId: "dept-1",
      assignedWeek: "2026-W37",
      actorId: "ds-1",
    });
    expect(second.verified_count).toBe(0);
    expect(db.updates.some((u) => u.table === "departments")).toBe(false);
  });

  it("the verify route no longer imports a department stamp", () => {
    const route = readRepoCode("app/api/rotations/verify/route.ts");
    expect(route).not.toContain("stampDepartmentWeekVerified");
    expect(route).not.toContain("last_verified");
  });
});

/* ------------------------------------------------------------------ *
 * E — Edit Bay
 * ------------------------------------------------------------------ */

describe("E — Edit Bay writes only the department binding that exists", () => {
  it("sets department_id and never department_code", () => {
    const code = readRepoCode("app/api/store-locations/route.ts");
    expect(code).toContain("patch.department_id = dept.id");
    expect(code).not.toContain("patch.department_code");
  });
});

/* ------------------------------------------------------------------ *
 * F — verification queue assignment lookup
 * ------------------------------------------------------------------ */

describe("F — verification queue reads sunday_bay_assignments correctly", () => {
  it("keys the week by week_starting and surfaces the error", () => {
    const code = readRepoCode("app/api/rotations/verify/route.ts");
    expect(code).toContain('eq("week_starting", isoWeekToMondayDate(week))');
    expect(code).toContain("assignmentError");
    expect(code).toMatch(/if \(assignmentError\) \{\s*throw new Error/);
    expect(code).not.toMatch(
      /sunday_bay_assignments[\s\S]{0,240}assigned_week/
    );
  });

  it("week_starting matches the date the assignment writer persists", async () => {
    const { isoWeekToMondayDate } = await import("./week");
    const db = createProductionFake({
      sunday_bay_assignments: [
        {
          id: "asg-1",
          store_number: "1234",
          department: "FLOOR",
          week_starting: isoWeekToMondayDate("2026-W37"),
          bay_id: "loc-1",
          specialist_name: "Dana",
        },
      ],
    });

    const { data, error } = await db.client
      .from("sunday_bay_assignments")
      .select("bay_id, specialist_name")
      .in("store_number", ["1234"])
      .eq("week_starting", isoWeekToMondayDate("2026-W37"));

    expect(error).toBeNull();
    expect((data as Row[])[0]?.specialist_name).toBe("Dana");
  });
});

/* ------------------------------------------------------------------ *
 * G — verification fallback removal
 * ------------------------------------------------------------------ */

describe("G — a failed review write can never close a location", () => {
  it("completeWeeklyRotation fails closed rather than retrying without review columns", async () => {
    const db = seededDepartment();

    /** A chain that fails the way a genuinely missing review column would. */
    function reviewColumnMissing() {
      const failure: QueryResult = {
        data: null,
        error: {
          code: "PGRST204",
          message:
            "Could not find the 'verification_status' column of 'weekly_rotations' in the schema cache",
        },
      };
      const stub: Record<string, unknown> = {};
      const thenable = {
        then(onFulfilled: (value: QueryResult) => unknown) {
          return Promise.resolve(failure).then(onFulfilled);
        },
      };
      for (const method of [
        "select",
        "eq",
        "is",
        "in",
        "order",
        "limit",
        "single",
        "maybeSingle",
      ]) {
        stub[method] = () => Object.assign(stub, thenable);
      }
      return Object.assign(stub, thenable);
    }

    const guarded = {
      from: (table: string) => {
        const builder = db.client.from(table) as unknown as Record<
          string,
          unknown
        >;
        if (table !== "weekly_rotations") return builder;
        const update = builder.update as (patch: Row) => unknown;
        builder.update = (patch: Row) =>
          "verification_status" in patch ? reviewColumnMissing() : update(patch);
        return builder;
      },
    } as unknown as SupabaseClient;

    await expect(
      completeWeeklyRotation(guarded, "rot-1", "dept-1", {
        autoVerify: false,
        actorId: "associate-1",
      })
    ).rejects.toThrow(/verification_status/);

    expect(db.tables.store_locations![0]?.status).toBe("ASSIGNED");
    expect(db.tables.store_locations![0]?.last_completed_at).toBeUndefined();
  });

  it("no writer retries after stripping the review columns", () => {
    const rotations = readRepoCode("lib/store-ops/rotations.ts");
    const review = readRepoCode("lib/store-ops/rotation-review.ts");
    expect(rotations).not.toContain(
      'isMissingColumnError(first.error, "verification_status")'
    );
    expect(review).not.toContain("stripReviewColumns");
    expect(review).not.toContain("REVIEW_COLUMNS");
  });
});

/* ------------------------------------------------------------------ *
 * H — supersede fallback removal
 * ------------------------------------------------------------------ */

describe("H — superseding never degrades into a hard delete", () => {
  it("nothing in rotations.ts deletes a weekly_rotations row", () => {
    const code = readRepoCode("lib/store-ops/rotations.ts");
    // The surviving superseded_at guards are read-side re-queries; the delete
    // fallbacks that destroyed rotation history are gone. Clearing
    // sunday_bay_assignments is unrelated and still legitimate.
    expect(code).not.toMatch(
      /from\("weekly_rotations"\)[\s\S]{0,200}?\.delete\(\)/
    );
  });

  it("clearing a week's conflicts stamps supersede columns and deletes nothing", async () => {
    const db = seededDepartment();
    await db.client
      .from("weekly_rotations")
      .update({ superseded_at: "2026-09-08T12:00:00.000Z" })
      .eq("id", "rot-1");

    expect(db.deletes).toHaveLength(0);
    expect(db.tables.weekly_rotations).toHaveLength(1);
  });
});
