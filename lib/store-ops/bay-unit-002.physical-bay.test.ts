/**
 * BAY-UNIT-002 — physical bay coverage grouping.
 *
 * One department + aisle + bay is one rotation / allocation / verification unit.
 * SELLING and TOPSTOCK remain topology surfaces, not independent jobs.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import type { StoreLocation } from "./types";
import { formatBayTag, formatLocationLabel } from "./types";
import {
  composePhysicalBayCandidate,
  groupLocationsByPhysicalBay,
  physicalBayIsOwed,
  physicalBayKey,
  representativePhysicalBayLocation,
  selectPhysicalBayCoverage,
} from "./physical-bay";
import { planProportionalBayAssignments } from "./weekly-rotations";
import {
  verifyPendingRotation,
} from "./rotation-review";
import { completeWeeklyRotation } from "./rotations";
import type { SupabaseClient } from "@supabase/supabase-js";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function loc(
  overrides: Partial<StoreLocation> &
    Pick<StoreLocation, "id" | "aisle" | "bay" | "type">
): StoreLocation {
  return {
    store_id: "store-1",
    department_id: "dept-1",
    status: "PENDING",
    last_completed_at: null,
    cycle_number: 1,
    is_active: true,
    location_type: "STANDARD",
    velocity_tier: "standard",
    ...overrides,
  };
}

function pair(
  aisle: string,
  bay: number,
  extra?: { selling?: Partial<StoreLocation>; topstock?: Partial<StoreLocation> }
): StoreLocation[] {
  return [
    loc({
      id: `${aisle}-${bay}-S`,
      aisle,
      bay,
      type: "SELLING",
      ...extra?.selling,
    }),
    loc({
      id: `${aisle}-${bay}-T`,
      aisle,
      bay,
      type: "TOPSTOCK",
      ...extra?.topstock,
    }),
  ];
}

describe("physical bay identity", () => {
  it("SELLING + TOPSTOCK of the same department/aisle/bay share one coverage key", () => {
    const [selling, topstock] = pair("41", 11);
    expect(physicalBayKey(selling)).toBe(physicalBayKey(topstock));
    expect(physicalBayKey(selling)).toBe("dept-1|41|11");
  });

  it("different bay remains a different coverage unit", () => {
    const a = loc({ id: "a", aisle: "41", bay: 11, type: "SELLING" });
    const b = loc({ id: "b", aisle: "41", bay: 12, type: "SELLING" });
    expect(physicalBayKey(a)).not.toBe(physicalBayKey(b));
  });

  it("different department remains a different coverage unit", () => {
    const a = loc({
      id: "a",
      aisle: "41",
      bay: 11,
      type: "SELLING",
      department_id: "flooring",
    });
    const b = loc({
      id: "b",
      aisle: "41",
      bay: 11,
      type: "SELLING",
      department_id: "paint",
    });
    expect(physicalBayKey(a)).not.toBe(physicalBayKey(b));
  });

  it("does not include type or location UUID in the key", () => {
    const source = readRepo("lib/store-ops/physical-bay.ts");
    expect(source).toMatch(/department_id.*normalizeAisle.*bay/);
    expect(source).not.toMatch(/physicalBayKey[\s\S]{0,200}loc\.type/);
    expect(source).not.toMatch(/physicalBayKey[\s\S]{0,200}loc\.id/);
  });
});

describe("generation grouping", () => {
  it("a physical bay with both surfaces consumes only one staging slot", () => {
    const selected = selectPhysicalBayCoverage(pair("41", 11), [], 12);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.key).toBe("dept-1|41|11");
    expect(selected[0]?.representative.type).toBe("SELLING");
    expect(selected[0]?.assignIds.sort()).toEqual([
      "41-11-S",
      "41-11-T",
    ].sort());
  });

  it("a target of 12 stages 12 distinct physical bays when 12 are available", () => {
    const pending = Array.from({ length: 12 }, (_, i) =>
      pair("41", i + 1)
    ).flat();
    const selected = selectPhysicalBayCoverage(pending, [], 12);
    expect(selected).toHaveLength(12);
    const keys = new Set(selected.map((row) => row.key));
    expect(keys.size).toBe(12);
    expect(selected.every((row) => row.representative.type === "SELLING")).toBe(
      true
    );
  });

  it("never pads a short physical-bay population with sibling surfaces", () => {
    const pending = [
      ...pair("41", 11),
      ...pair("41", 12),
      ...pair("41", 13),
      ...pair("41", 14),
      ...pair("41", 15),
    ];
    const selected = selectPhysicalBayCoverage(pending, [], 12);
    expect(selected).toHaveLength(5);
    expect(new Set(selected.map((row) => row.key)).size).toBe(5);
  });

  it("prefers the SELLING row as the weekly_rotations representative when it still owes coverage", () => {
    const [selling] = pair("41", 11);
    expect(representativePhysicalBayLocation(pair("41", 11))?.id).toBe(
      selling.id
    );
  });
});

describe("selection signal composition", () => {
  it("does not discard sibling priority / velocity / carry-over evidence", () => {
    const surfaces = pair("41", 11, {
      selling: { velocity_tier: "standard", status: "PENDING" },
      topstock: {
        velocity_tier: "critical_hotspot",
        priority_override: true,
        carried_over: true,
        last_carried_over_at: "2026-09-14T00:00:00.000Z",
        status: "CARRIED_OVER",
      },
    });
    const group = groupLocationsByPhysicalBay(surfaces)[0]!;
    const composed = composePhysicalBayCandidate(group)!;
    expect(composed.velocity_tier).toBe("critical_hotspot");
    expect(composed.priority_override).toBe(true);
    expect(composed.carried_over).toBe(true);
    expect(composed.status).toBe("CARRIED_OVER");
    const selected = selectPhysicalBayCoverage([], surfaces, 4);
    expect(selected).toHaveLength(1);
  });

  it("inactive and SHOWROOM surfaces do not create phantom work", () => {
    const pending = [
      loc({
        id: "inactive-s",
        aisle: "41",
        bay: 11,
        type: "SELLING",
        is_active: false,
      }),
      loc({
        id: "showroom-t",
        aisle: "41",
        bay: 11,
        type: "TOPSTOCK",
        location_type: "SHOWROOM_STACKOUT",
      }),
      ...pair("42", 1),
    ];
    const selected = selectPhysicalBayCoverage(pending, [], 12);
    expect(selected.map((row) => row.key)).toEqual(["dept-1|42|1"]);
  });
});

describe("weekly target counts physical bays", () => {
  it("drawCount is applied after grouping, not per surface row", () => {
    const generate = readRepo("lib/store-ops/rotations.ts");
    expect(generate).toMatch(/selectPhysicalBayCoverage\(/);
    expect(generate).toMatch(
      /pending\.filter\(isStandardAisleLocation\)/
    );
    expect(generate).toMatch(
      /carried\.filter\(isStandardAisleLocation\)/
    );
    expect(generate).toMatch(
      /selectPhysicalBayCoverage\(\s*aislePending,\s*aisleCarried,\s*drawCount/
    );
    const week = readRepo("lib/store-ops/week.ts");
    expect(week).toMatch(/distinct physical aisle\/bay/);
  });
});

describe("allocation input cardinality", () => {
  it("three distinct physical bays are three planner units", () => {
    const bays = [
      { rotationId: "r1", aisle: "41", bay: 11, riskScore: 0 },
      { rotationId: "r2", aisle: "41", bay: 12, riskScore: 0 },
      { rotationId: "r3", aisle: "41", bay: 13, riskScore: 0 },
    ];
    const plan = planProportionalBayAssignments(bays, [
      {
        specialist_id: "a",
        specialist_name: "A",
        active: true,
        hours: 8,
      },
    ]);
    expect(plan.items).toHaveLength(3);
  });

  it("one physical bay with two topology surfaces is not two planner units after grouping", () => {
    const selected = selectPhysicalBayCoverage(
      [...pair("41", 11), ...pair("41", 12), ...pair("41", 13)],
      [],
      12
    );
    const plan = planProportionalBayAssignments(
      selected.map((row) => ({
        rotationId: row.representative.id,
        aisle: row.representative.aisle,
        bay: row.representative.bay,
        riskScore: 0,
      })),
      [
        {
          specialist_id: "a",
          specialist_name: "A",
          active: true,
          hours: 8,
        },
      ]
    );
    expect(selected).toHaveLength(3);
    expect(plan.items).toHaveLength(3);
  });

  it("LAB-WEEK-002 labor composer is unchanged", () => {
    const labor = readRepo("lib/store-ops/labor-availability.ts");
    expect(labor).toMatch(/export function composeWeekLaborAvailability/);
    const planner = readRepo("lib/store-ops/weekly-rotations.ts");
    expect(planner).toMatch(/proportionalQuotas\(hours, bays\.length\)/);
  });
});

describe("carryover grouping", () => {
  it("one unresolved physical bay remains one future obligation", () => {
    const selected = selectPhysicalBayCoverage(
      [
        loc({
          id: "41-11-T",
          aisle: "41",
          bay: 11,
          type: "TOPSTOCK",
          status: "PENDING",
        }),
      ],
      [
        loc({
          id: "41-11-S",
          aisle: "41",
          bay: 11,
          type: "SELLING",
          status: "CARRIED_OVER",
          carried_over: true,
        }),
      ],
      8
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.key).toBe("dept-1|41|11");
  });

  it("a historically completed sibling does not make the bay fully covered", () => {
    const surfaces = pair("41", 11, {
      selling: {
        status: "COMPLETED",
        last_completed_at: "2026-08-01T00:00:00.000Z",
      },
      topstock: { status: "PENDING" },
    });
    expect(physicalBayIsOwed(surfaces)).toBe(true);
    const selected = selectPhysicalBayCoverage(surfaces, [], 4);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.representative.type).toBe("TOPSTOCK");
    expect(selected[0]?.assignIds).toEqual(["41-11-T"]);
  });
});

describe("cycle memory", () => {
  it("both surfaces COMPLETED means the physical bay is no longer owed", () => {
    const surfaces = pair("41", 11, {
      selling: { status: "COMPLETED" },
      topstock: { status: "COMPLETED" },
    });
    expect(physicalBayIsOwed(surfaces)).toBe(false);
    expect(selectPhysicalBayCoverage(surfaces, [], 4)).toHaveLength(0);
  });
});

describe("call-out cardinality", () => {
  it("redistributes persisted weekly rotation rows and does not re-split surfaces", () => {
    const source = readRepo("lib/store-ops/call-out.ts");
    expect(source).toMatch(/const bays: RotationBayRef\[\] = mine\.map/);
    expect(source).not.toMatch(/TOPSTOCK/);
    expect(source).not.toMatch(/groupLocationsByPhysicalBay/);
  });
});

describe("Stage / Assign presentation", () => {
  it("Sunday staged labels use the physical bay tag, not SELLING/TOPSTOCK jobs", () => {
    const sunday = readRepo("lib/store-ops/sunday-audit.ts");
    expect(sunday).toMatch(/formatBayTag\(loc\)/);
    expect(sunday).not.toMatch(/formatLocationLabel/);
    const modal = readRepo(
      "components/admin/SundayAuditAssignmentModal.tsx"
    );
    expect(modal).toMatch(/full physical bay/);
    expect(modal).toMatch(/formatBayTag\(\{ aisle: bay\.aisle, bay: bay\.bay \}\)/);
  });

  it("formatLocationLabel remains available for topology, not weekly assignment", () => {
    expect(formatBayTag({ aisle: "41", bay: 11 })).toBe("A41-B11");
    expect(formatLocationLabel({ aisle: "41", bay: 11, type: "SELLING" })).toContain(
      "SELLING"
    );
  });
});

describe("generation does not invent Lowe's task states or people×3", () => {
  it("physical-bay module has no packdown/zone/label task states", () => {
    const source = readRepo("lib/store-ops/physical-bay.ts");
    expect(source).not.toMatch(/packdown|front-face|front_face|labeling|zoning/i);
    expect(source).not.toMatch(/people\s*\*\s*3/);
  });

  it("no schema migration was added for a parent physical bay", () => {
    const migrations = fs.readdirSync(path.join(root, "supabase/migrations"));
    expect(migrations.some((name) => /physical_bay|parent_id/i.test(name))).toBe(
      false
    );
  });
});

/* ------------------------------------------------------------------ *
 * Verification fan-out against an in-memory fake
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

function createFakeDb(seed: { rotations?: Row[]; locations?: Row[] }) {
  const rotations: Row[] = seed.rotations ? [...seed.rotations] : [];
  const locations: Row[] = seed.locations ? [...seed.locations] : [];

  function tableRows(table: string): Row[] {
    if (table === "weekly_rotations") return rotations;
    if (table === "store_locations") return locations;
    if (table === "weekly_rotation_completion_attempts") {
      throw new Error('relation "public.weekly_rotation_completion_attempts" does not exist');
    }
    throw new Error(`Unexpected table ${table}`);
  }

  function from(table: string) {
    if (table === "weekly_rotation_completion_attempts") {
      const missing: QueryResult = {
        data: null,
        error: {
          code: "42P01",
          message:
            'relation "public.weekly_rotation_completion_attempts" does not exist',
        },
      };
      const api: Record<string, unknown> = {};
      const thenable = {
        then(onFulfilled: (v: QueryResult) => unknown) {
          return Promise.resolve(missing).then(onFulfilled);
        },
      };
      for (const method of [
        "select",
        "insert",
        "update",
        "eq",
        "is",
        "in",
        "order",
        "limit",
        "single",
        "maybeSingle",
      ]) {
        api[method] = () => Object.assign(api, thenable);
      }
      return Object.assign(api, thenable);
    }

    const filters: Array<{ col: string; val: unknown }> = [];
    let mode: "select" | "update" = "select";
    let patch: Row | null = null;
    let wantSingle = false;
    let wantMaybeSingle = false;

    const matches = (row: Row) =>
      filters.every((f) => String(row[f.col] ?? "") === String(f.val ?? ""));

    const run = async (): Promise<QueryResult> => {
      const rows = tableRows(table).filter(matches);
      if (mode === "update" && patch) {
        for (const row of rows) Object.assign(row, patch);
      }
      if (wantSingle) {
        if (!rows[0]) {
          return {
            data: null,
            error: { message: "JSON object requested, 0 rows returned" },
          };
        }
        return { data: { ...rows[0] }, error: null };
      }
      if (wantMaybeSingle) {
        return { data: rows[0] ? { ...rows[0] } : null, error: null };
      }
      return { data: rows.map((r) => ({ ...r })), error: null };
    };

    const api: Record<string, unknown> = {};
    const thenable = {
      then(
        onFulfilled: (v: QueryResult) => unknown,
        onRejected?: (e: unknown) => unknown
      ) {
        return run().then(onFulfilled, onRejected);
      },
    };
    Object.assign(api, {
      select: () => Object.assign(api, thenable),
      update: (next: Row) => {
        mode = "update";
        patch = next;
        return Object.assign(api, thenable);
      },
      eq: (col: string, val: unknown) => {
        filters.push({ col, val });
        return Object.assign(api, thenable);
      },
      is: (col: string, val: unknown) => {
        filters.push({ col, val });
        return Object.assign(api, thenable);
      },
      order: () => Object.assign(api, thenable),
      limit: () => Object.assign(api, thenable),
      single: () => {
        wantSingle = true;
        return Object.assign(api, thenable);
      },
      maybeSingle: () => {
        wantMaybeSingle = true;
        return Object.assign(api, thenable);
      },
    });
    return Object.assign(api, thenable);
  }

  return {
    client: { from } as unknown as SupabaseClient,
    locations,
    rotations,
  };
}

describe("verification fan-out", () => {
  it("authoritative verification advances both sibling coverage rows", async () => {
    const db = createFakeDb({
      rotations: [
        {
          id: "rot-1",
          department_id: "dept-1",
          location_id: "loc-s",
          assigned_week: "2026-W38",
          is_completed: true,
          completed_at: "2026-09-16T15:00:00.000Z",
          completed_by: "associate-1",
          verification_status: "PENDING_VERIFICATION",
          superseded_at: null,
        },
      ],
      locations: [
        {
          id: "loc-s",
          department_id: "dept-1",
          aisle: "41",
          bay: 11,
          type: "SELLING",
          status: "ASSIGNED",
          last_completed_at: null,
          is_active: true,
          location_type: "STANDARD",
          carried_over: false,
        },
        {
          id: "loc-t",
          department_id: "dept-1",
          aisle: "41",
          bay: 11,
          type: "TOPSTOCK",
          status: "ASSIGNED",
          last_completed_at: null,
          is_active: true,
          location_type: "STANDARD",
          carried_over: false,
        },
      ],
    });

    const { location } = await verifyPendingRotation(
      db.client,
      "rot-1",
      "ds-1",
      "dept-1"
    );
    expect(location?.status).toBe("COMPLETED");
    expect(location?.last_completed_at).toBeTruthy();
    const topstock = db.locations.find((row) => row.id === "loc-t");
    expect(topstock?.status).toBe("COMPLETED");
    expect(topstock?.last_completed_at).toBe(location?.last_completed_at);
  });

  it("associate report / offline replay does not fan-out completion", async () => {
    const db = createFakeDb({
      rotations: [
        {
          id: "rot-1",
          department_id: "dept-1",
          location_id: "loc-s",
          assigned_week: "2026-W38",
          is_completed: false,
          completed_at: null,
          completed_by: null,
          verification_status: "PENDING",
          superseded_at: null,
        },
      ],
      locations: [
        {
          id: "loc-s",
          department_id: "dept-1",
          aisle: "41",
          bay: 11,
          type: "SELLING",
          status: "ASSIGNED",
          last_completed_at: null,
          is_active: true,
          location_type: "STANDARD",
        },
        {
          id: "loc-t",
          department_id: "dept-1",
          aisle: "41",
          bay: 11,
          type: "TOPSTOCK",
          status: "ASSIGNED",
          last_completed_at: null,
          is_active: true,
          location_type: "STANDARD",
        },
      ],
    });

    await completeWeeklyRotation(db.client, "rot-1", "dept-1", {
      autoVerify: false,
      actorId: "associate-1",
    });
    expect(db.locations.every((row) => row.status === "ASSIGNED")).toBe(true);
    expect(db.locations.every((row) => row.last_completed_at == null)).toBe(true);
  });

  it("markPhysicalBayCompleted is the verify/auto-verify location closer", () => {
    const review = readRepo("lib/store-ops/rotation-review.ts");
    expect(review).toMatch(/markPhysicalBayCompleted\(/);
    const rotations = readRepo("lib/store-ops/rotations.ts");
    expect(rotations).toMatch(/markPhysicalBayCompleted\(/);
    expect(rotations).toMatch(/resolveCompletionAutoVerify/);
  });
});
