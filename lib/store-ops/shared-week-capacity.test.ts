/**
 * DEPTSYNC-CAPACITY-GUARD-002 — store-week shared capacity.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  BASE_WEEKLY_BAY_QUOTA,
  composeStoreWeekCapacity,
  filterPlanItemsToCapacity,
  resolveCapacityOwnerId,
  resolveDepartmentStageDrawCount,
  UPSERT_SUNDAY_ASSIGNMENTS_WITH_CAPACITY_RPC,
  writeSundayAssignmentsWithCapacity,
  type CapacityAssignmentRow,
} from "./shared-week-capacity";
import { resolveAutomaticWeeklyBayTarget } from "./week";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function member(
  id: string,
  role: string,
  home: string | null,
  assigned: string | null = home
) {
  return {
    id,
    name: id,
    role,
    is_active: true,
    home_department: home,
    assigned_department: assigned,
  };
}

function shift(
  specialist_id: string,
  work_date: string,
  start = "08:00",
  end = "16:00"
) {
  return {
    specialist_id,
    work_date,
    start_time: start,
    end_time: end,
    is_scheduled_today: true,
    is_call_out: false,
    status: "ON_DUTY",
  };
}

/** Mon–Sun of 2026-W41 */
const WEEK = "2026-W41";
const DATES = [
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
  "2026-10-09",
  "2026-10-10",
  "2026-10-11",
];

function shiftsFor(...ids: string[]) {
  return ids.flatMap((id) => DATES.map((d) => shift(id, d)));
}

function owned(
  bay_id: string,
  roster_specialist_id: string,
  department = "flooring"
): CapacityAssignmentRow {
  return {
    bay_id,
    department,
    roster_specialist_id,
    status: "assigned",
  };
}

describe("CAPACITY-GUARD-002 composeStoreWeekCapacity", () => {
  it("one eligible associate → shared target 3", () => {
    const capacity = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce: [member("tracy", "Associate", "flooring")],
      persisted_shift_days: shiftsFor("tracy"),
      assignments: [],
    });
    expect(capacity.eligible_count).toBe(1);
    expect(capacity.shared_target).toBe(3);
    expect(capacity.remaining_shared).toBe(3);
  });

  it("two eligible associates → shared target 6 (production evidence model)", () => {
    const capacity = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce: [
        member("tracy", "Associate", "flooring"),
        member("tyson", "Supervisor", "flooring"),
      ],
      persisted_shift_days: shiftsFor("tracy", "tyson"),
      assignments: [owned("r1", "tracy"), owned("r2", "tracy"), owned("r3", "tracy")],
    });
    expect(capacity.eligible_count).toBe(2);
    expect(capacity.shared_target).toBe(6);
    expect(capacity.owned_total).toBe(3);
    expect(capacity.remaining_shared).toBe(3);
    expect(capacity.remaining_by_specialist.tracy).toBe(0);
    expect(capacity.remaining_by_specialist.tyson).toBe(3);
  });

  it("four eligible → shared twelve; does not hardcode when fewer eligible", () => {
    const four = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce: ["a", "b", "c", "d"].map((id) =>
        member(id, "Associate", "flooring")
      ),
      persisted_shift_days: shiftsFor("a", "b", "c", "d"),
      assignments: [],
    });
    expect(four.shared_target).toBe(12);
    expect(resolveAutomaticWeeklyBayTarget(4)).toBe(12);

    const two = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce: ["a", "b"].map((id) => member(id, "Associate", "flooring")),
      persisted_shift_days: shiftsFor("a", "b"),
      assignments: [],
    });
    expect(two.shared_target).toBe(6);
  });

  it("five roster records but MasterAdmin excluded → four humans when scheduled", () => {
    const capacity = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce: [
        member("master", "MasterAdmin", null, "all"),
        member("tyson", "Supervisor", "flooring"),
        member("nate", "Associate", null, "flooring"),
        member("nick", "Associate", null, "flooring"),
        member("tracy", "Associate", null, "flooring"),
      ],
      persisted_shift_days: shiftsFor("tyson", "nate", "nick", "tracy"),
      assignments: [],
    });
    expect(capacity.eligible_specialist_ids).not.toContain("master");
    expect(capacity.eligible_count).toBe(4);
    expect(capacity.shared_target).toBe(12);
  });

  it("missing schedule evidence does not archive — AUTO-005A keeps active associates eligible", () => {
    const capacity = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce: [
        member("nate", "Associate", null, "flooring"),
        member("tracy", "Associate", null, "flooring"),
      ],
      // Only Tracy has shifts; Nate still remains weekly-assignment eligible.
      persisted_shift_days: shiftsFor("tracy"),
      assignments: [],
    });
    expect(capacity.eligible_specialist_ids).toEqual(["nate", "tracy"]);
    expect(capacity.shared_target).toBe(6);
  });

  it("completed assignments still consume capacity", () => {
    const capacity = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce: [member("tracy", "Associate", "flooring")],
      persisted_shift_days: shiftsFor("tracy"),
      assignments: [
        { bay_id: "r1", roster_specialist_id: "tracy", status: "completed" },
        { bay_id: "r2", roster_specialist_id: "tracy", status: "completed" },
        { bay_id: "r3", roster_specialist_id: "tracy", status: "assigned" },
      ],
    });
    expect(capacity.owned_total).toBe(3);
    expect(capacity.remaining_shared).toBe(0);
    expect(capacity.remaining_by_specialist.tracy).toBe(0);
  });

  it("cleared assignments do not consume capacity", () => {
    const capacity = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce: [member("tracy", "Associate", "flooring")],
      persisted_shift_days: shiftsFor("tracy"),
      assignments: [
        { bay_id: "r1", roster_specialist_id: "tracy", status: "cleared" },
      ],
    });
    expect(capacity.owned_total).toBe(0);
    expect(capacity.remaining_shared).toBe(3);
  });

  it("two active departments share one eligible union (no double count)", () => {
    // Use two real DepartmentScope codes (home_decor not registered yet).
    const capacity = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring", "paint"],
      workforce: [
        member("floor1", "Associate", "flooring"),
        member("floor2", "Associate", "flooring"),
        member("paint1", "Associate", "paint"),
        member("paint2", "Associate", "paint"),
      ],
      persisted_shift_days: shiftsFor("floor1", "floor2", "paint1", "paint2"),
      assignments: [
        owned("a1", "floor1", "flooring"),
        owned("a2", "floor1", "flooring"),
        owned("a3", "floor1", "flooring"),
      ],
    });
    expect(capacity.eligible_count).toBe(4);
    expect(capacity.shared_target).toBe(12);
    expect(capacity.owned_total).toBe(3);
    expect(capacity.remaining_shared).toBe(9);
    // Same human counted once even if somehow listed twice in workforce.
    const dup = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring", "paint"],
      workforce: [
        member("floor1", "Associate", "flooring"),
        member("floor1", "Associate", "flooring"),
      ],
      persisted_shift_days: shiftsFor("floor1"),
      assignments: [],
    });
    expect(dup.eligible_count).toBe(1);
  });

  it("does not merge identity by matching names", () => {
    const capacity = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce: [
        { ...member("id-a", "Associate", "flooring"), name: "Tracy" },
        { ...member("id-b", "Associate", "flooring"), name: "Tracy" },
      ],
      persisted_shift_days: shiftsFor("id-a", "id-b"),
      assignments: [
        owned("r1", "id-a"),
        owned("r2", "id-b"),
      ],
    });
    expect(capacity.eligible_count).toBe(2);
    expect(capacity.owned_by_specialist["id-a"]).toBe(1);
    expect(capacity.owned_by_specialist["id-b"]).toBe(1);
  });

  it("uses verified profile→roster link only when roster id missing", () => {
    const owner = resolveCapacityOwnerId(
      {
        bay_id: "r1",
        assigned_specialist_id: "profile-1",
        roster_specialist_id: null,
        status: "assigned",
      },
      new Map([["profile-1", "tracy"]])
    );
    expect(owner).toBe("tracy");
    expect(
      resolveCapacityOwnerId(
        {
          bay_id: "r1",
          assigned_specialist_id: "profile-1",
          status: "assigned",
        },
        null
      )
    ).toBeNull();
  });

  it("over-capacity weeks are flagged; midweek schedule loss preserves owned counts", () => {
    const capacity = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce: [member("tracy", "Associate", "flooring")],
      // AUTO-005A: zero shifts still leave Tracy assignment-eligible (natural ×3).
      persisted_shift_days: [],
      assignments: [
        owned("r1", "tracy"),
        owned("r2", "tracy"),
        owned("r3", "tracy"),
        owned("r4", "tracy"),
      ],
    });
    expect(capacity.eligible_count).toBe(1);
    expect(capacity.shared_target).toBe(3);
    expect(capacity.owned_total).toBe(4);
    expect(capacity.over_capacity).toBe(true);
    expect(capacity.owned_by_specialist.tracy).toBe(4);
  });

  it("cross-store isolation: composition is scoped to provided store assignments", () => {
    const a = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce: [member("tracy", "Associate", "flooring")],
      persisted_shift_days: shiftsFor("tracy"),
      assignments: [owned("r1", "tracy")],
    });
    const b = composeStoreWeekCapacity({
      store_number: "1852",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce: [member("other", "Associate", "flooring")],
      persisted_shift_days: shiftsFor("other"),
      assignments: [],
    });
    expect(a.owned_total).toBe(1);
    expect(b.owned_total).toBe(0);
    expect(a.store_number).not.toBe(b.store_number);
  });
});

describe("CAPACITY-GUARD-002 stage draw + plan filter", () => {
  it("department draw is capped by shared remaining", () => {
    const capacity = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring", "paint"],
      workforce: [
        member("a", "Associate", "flooring"),
        member("b", "Associate", "flooring"),
        member("c", "Associate", "paint"),
        member("d", "Associate", "paint"),
      ],
      persisted_shift_days: shiftsFor("a", "b", "c", "d"),
      assignments: Array.from({ length: 12 }, (_, i) =>
        owned(`r${i}`, ["a", "b", "c", "d"][i % 4]!, i < 6 ? "flooring" : "paint")
      ),
    });
    expect(capacity.remaining_shared).toBe(0);
    expect(
      resolveDepartmentStageDrawCount({
        departmentEligibleCount: 2,
        capacity,
      })
    ).toBe(0);
  });

  it("filterPlanItemsToCapacity enforces 3 per person and shared max", () => {
    const capacity = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce: ["a", "b"].map((id) => member(id, "Associate", "flooring")),
      persisted_shift_days: shiftsFor("a", "b"),
      assignments: [owned("r1", "a"), owned("r2", "a"), owned("r3", "a")],
    });
    const { accepted, rejected } = filterPlanItemsToCapacity(
      [
        { specialist_id: "a", rotationId: "r4" },
        { specialist_id: "b", rotationId: "r5" },
        { specialist_id: "b", rotationId: "r6" },
        { specialist_id: "b", rotationId: "r7" },
        { specialist_id: "b", rotationId: "r8" },
      ],
      capacity
    );
    expect(accepted.map((i) => i.rotationId)).toEqual(["r5", "r6", "r7"]);
    expect(rejected.some((i) => i.rotationId === "r4")).toBe(true);
    expect(rejected.some((i) => i.rotationId === "r8")).toBe(true);
  });

  it("reassignment intent is not silently deleted by filter (caller/DB owns swap)", () => {
    // Filter treats every item as net-new; reassignment path is DB writer's job.
    const capacity = composeStoreWeekCapacity({
      store_number: "2587",
      week_label: WEEK,
      department_codes: ["flooring"],
      workforce: ["a", "b"].map((id) => member(id, "Associate", "flooring")),
      persisted_shift_days: shiftsFor("a", "b"),
      assignments: [owned("r1", "a")],
    });
    const { accepted } = filterPlanItemsToCapacity(
      [{ specialist_id: "b", rotationId: "r2" }],
      capacity
    );
    expect(accepted).toHaveLength(1);
  });
});

describe("CAPACITY-GUARD-002 writer fail-closed + contracts", () => {
  it("writeSundayAssignmentsWithCapacity fails closed when RPC missing", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Could not find the function upsert_sunday_bay_assignments_with_capacity" },
      }),
    };
    const result = await writeSundayAssignmentsWithCapacity(supabase as never, {
      store_number: "2587",
      week_label: WEEK,
      shared_target: 6,
      items: [
        {
          department: "flooring",
          bay_id: "r1",
          roster_specialist_id: "tracy",
          specialist_name: "Tracy",
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("CAPACITY_RPC_MISSING");
    expect(result.error).toMatch(/refusing unguarded/i);
  });

  it("classifies person and shared capacity errors from RPC", async () => {
    const person = await writeSundayAssignmentsWithCapacity(
      {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "CAPACITY_PERSON_EXCEEDED: associate x already has 3 of 3" },
        }),
      } as never,
      {
        store_number: "2587",
        week_label: WEEK,
        shared_target: 6,
        items: [
          {
            department: "flooring",
            bay_id: "r1",
            roster_specialist_id: "x",
            specialist_name: "X",
          },
        ],
      }
    );
    expect(person.code).toBe("CAPACITY_PERSON_EXCEEDED");

    const shared = await writeSundayAssignmentsWithCapacity(
      {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "CAPACITY_SHARED_EXCEEDED: store-week already has 6 of 6" },
        }),
      } as never,
      {
        store_number: "2587",
        week_label: WEEK,
        shared_target: 6,
        items: [
          {
            department: "flooring",
            bay_id: "r1",
            roster_specialist_id: "x",
            specialist_name: "X",
          },
        ],
      }
    );
    expect(shared.code).toBe("CAPACITY_SHARED_EXCEEDED");
  });

  it("migration defines advisory-locked capacity RPC with auth harden", () => {
    const sql = readRepo(
      "supabase/migrations/20261014_capacity_guard_002_store_week_lock.sql"
    );
    expect(sql).toContain(UPSERT_SUNDAY_ASSIGNMENTS_WITH_CAPACITY_RPC);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/CAPACITY_PERSON_EXCEEDED/);
    expect(sql).toMatch(/CAPACITY_SHARED_EXCEEDED/);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/v_role = 'service_role'/);
    expect(sql).toMatch(/v_allow_over_base := false/);
    expect(sql).toMatch(/v_allow_over_shared := false/);
    expect(sql).toMatch(
      /revoke insert, update, delete, truncate, references, trigger/
    );
    expect(sql).toMatch(/sunday_bay_assignments/);
    expect(sql).not.toMatch(/delete from public\.sunday_bay_assignments/i);
  });

  it("browser live writer never honors payload override flags", () => {
    const audit = readRepo("lib/store-ops/sunday-audit.ts");
    expect(audit).toMatch(/browser\/queue payloads cannot elevate capacity/);
    expect(audit).not.toMatch(/payload\.allow_over_base/);
    expect(audit).not.toMatch(/payload\.allow_over_shared/);
  });

  it("sunday-dispatch and sunday-audit route writes through capacity RPC", () => {
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    const audit = readRepo("lib/store-ops/sunday-audit.ts");
    expect(dispatch).toMatch(/writeSundayAssignmentsWithCapacity|loadStoreWeekCapacity/);
    expect(dispatch).toMatch(/resolveDepartmentStageDrawCount/);
    expect(dispatch).toMatch(/participating_department_codes/);
    expect(audit).toMatch(/writeSundayAssignmentsWithCapacity/);
    expect(audit).toMatch(/loadStoreWeekCapacity/);
    // No unguarded upsert remaining in admin/live writers.
    expect(dispatch).not.toMatch(
      /\.from\("sunday_bay_assignments"\)\s*\n?\s*\.upsert/
    );
    expect(audit).not.toMatch(
      /\.from\("sunday_bay_assignments"\)\s*\n?\s*\.upsert/
    );
  });

  it("does not activate second-department auto-stage; cron stays single Sunday Hobby hit", () => {
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    const vercel = readRepo("vercel.json");
    expect(dispatch).toMatch(/\.eq\("is_active", true\)/);
    expect(dispatch).not.toMatch(/home_decor.*is_active:\s*true/);
    // AUTO-006: 12:00 UTC = Denver 05:00 MST / 06:00 MDT (year-round stage window)
    expect(vercel).toMatch(/"0 12 \* \* 0"/);
  });

  it("retired bay eligibility still requires is_active (unchanged location gate)", () => {
    const eligibility = readRepo("lib/store-ops/location-eligibility.ts");
    expect(eligibility).toMatch(/is_active === false/);
    expect(eligibility).toMatch(/SHOWROOM_STACKOUT/);
  });

  it("BASE_WEEKLY_BAY_QUOTA remains 3", () => {
    expect(BASE_WEEKLY_BAY_QUOTA).toBe(3);
  });
});

describe("CAPACITY-GUARD-002 concurrent staging contract", () => {
  it("documents that concurrency is the transactional RPC lock, not client counts", () => {
    const mod = readRepo("lib/store-ops/shared-week-capacity.ts");
    expect(mod).toMatch(/Fail-closed when the RPC is unavailable/);
    expect(mod).toMatch(/never falls back to unguarded upsert/i);
    const sql = readRepo(
      "supabase/migrations/20261014_capacity_guard_002_store_week_lock.sql"
    );
    // Same store-week key serializes concurrent writers in one transaction.
    expect(sql).toMatch(/store_week_capacity:/);
    expect(sql).toMatch(/for v_item in/i);
  });
});
