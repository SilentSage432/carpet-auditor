/**
 * DEPTSYNC-ROTATION-AUTO-008A — standing weekly capacity authorization.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  planStandingCapacityMaterialization,
  validateStandingPolicyItems,
  STANDING_CAPACITY_SOURCE_EXPLICIT,
  STANDING_CAPACITY_SOURCE_STANDING,
  type StandingCapacityPolicy,
  type ApprovalProvenanceRow,
} from "./standing-week-capacity";
import {
  buildAssociateWeekScheduleFingerprint,
  composeApprovedStoreWeekCapacity,
} from "./approved-week-capacity";
import { WEEKLY_ROTATION_AUTO_PUBLISH } from "./authoritative-week-cycle";

const ROOT = join(__dirname, "../..");

function readRepo(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const POLICY: StandingCapacityPolicy = {
  id: "policy-v1",
  store_number: "2587",
  policy_version: 1,
  is_active: true,
  effective_at: "2026-10-18T00:00:00.000Z",
  revoked_at: null,
  established_by_specialist_id: "master",
  note: "3/3/3/3",
  items: [
    { specialist_id: "tyson", approved_capacity: 3 },
    { specialist_id: "nate", approved_capacity: 3 },
    { specialist_id: "nick", approved_capacity: 3 },
    { specialist_id: "tracy", approved_capacity: 3 },
  ],
};

const ELIGIBLE = ["tyson", "nate", "nick", "tracy"] as const;

function emptyFp(sid: string): string {
  return buildAssociateWeekScheduleFingerprint([], sid);
}

const LIVE_FP: Record<string, string> = {
  tyson: emptyFp("tyson"),
  nate: emptyFp("nate"),
  nick: emptyFp("nick"),
  tracy: emptyFp("tracy"),
};

describe("AUTO-008A standing capacity policy validation", () => {
  it("accepts canonical 3/3/3/3 policy items", () => {
    const result = validateStandingPolicyItems(POLICY.items);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(4);
      expect(result.items.reduce((s, i) => s + i.approved_capacity, 0)).toBe(12);
    }
  });

  it("rejects duplicates and out-of-range capacity", () => {
    expect(
      validateStandingPolicyItems([
        { specialist_id: "tyson", approved_capacity: 3 },
        { specialist_id: "tyson", approved_capacity: 3 },
      ]).ok
    ).toBe(false);
    expect(
      validateStandingPolicyItems([
        { specialist_id: "tyson", approved_capacity: 4 },
      ]).ok
    ).toBe(false);
  });

  it("rejects unauthorized empty policy", () => {
    expect(validateStandingPolicyItems([]).ok).toBe(false);
  });
});

describe("AUTO-008A standing materialization planner", () => {
  it("fails closed when standing policy is missing", () => {
    const plan = planStandingCapacityMaterialization({
      store_number: "2587",
      week_label: "2026-W44",
      policy: null,
      eligible_specialist_ids: ELIGIBLE,
      existing_approvals: [],
      provenance_by_specialist: new Map(),
      live_fingerprints: LIVE_FP,
      owned_by_specialist: {},
      owned_total: 0,
    });
    expect(plan.action).toBe("fail");
    if (plan.action === "fail") {
      expect(plan.code).toBe("STANDING_CAPACITY_MISSING");
    }
  });

  it("materializes W44 as 3/3/3/3 when empty", () => {
    const plan = planStandingCapacityMaterialization({
      store_number: "2587",
      week_label: "2026-W44",
      policy: POLICY,
      eligible_specialist_ids: ELIGIBLE,
      existing_approvals: [],
      provenance_by_specialist: new Map(),
      live_fingerprints: LIVE_FP,
      owned_by_specialist: {},
      owned_total: 0,
    });
    expect(plan.action).toBe("write");
    if (plan.action === "write") {
      expect(plan.items).toHaveLength(4);
      expect(plan.items.every((i) => i.approved_capacity === 3)).toBe(true);
      expect(plan.items.reduce((s, i) => s + i.approved_capacity, 0)).toBe(12);
      expect(plan.policy_id).toBe("policy-v1");
    }
  });

  it("materializes W45 as 3/3/3/3 independently", () => {
    const plan = planStandingCapacityMaterialization({
      store_number: "2587",
      week_label: "2026-W45",
      policy: POLICY,
      eligible_specialist_ids: ELIGIBLE,
      existing_approvals: [],
      provenance_by_specialist: new Map(),
      live_fingerprints: LIVE_FP,
      owned_by_specialist: {},
      owned_total: 0,
    });
    expect(plan.action).toBe("write");
    if (plan.action === "write") {
      expect(plan.items.map((i) => i.specialist_id).sort()).toEqual(
        [...ELIGIBLE].sort()
      );
    }
  });

  it("is idempotent when standing approvals already fresh", () => {
    const approvals = ELIGIBLE.map((sid) => ({
      store_number: "2587",
      week_label: "2026-W44",
      week_starting: "2026-10-26",
      specialist_id: sid,
      approved_capacity: 3,
      schedule_fingerprint: LIVE_FP[sid]!,
      approved_by_specialist_id: "master",
      approved_at: "2026-10-18T00:00:00.000Z",
    }));
    const provenance = new Map<string, ApprovalProvenanceRow>(
      ELIGIBLE.map((sid) => [
        sid,
        {
          store_number: "2587",
          week_label: "2026-W44",
          specialist_id: sid,
          source: STANDING_CAPACITY_SOURCE_STANDING,
          standing_policy_id: "policy-v1",
          materialized_at: "2026-10-18T00:00:00.000Z",
        },
      ])
    );
    const plan = planStandingCapacityMaterialization({
      store_number: "2587",
      week_label: "2026-W44",
      policy: POLICY,
      eligible_specialist_ids: ELIGIBLE,
      existing_approvals: approvals,
      provenance_by_specialist: provenance,
      live_fingerprints: LIVE_FP,
      owned_by_specialist: {},
      owned_total: 0,
    });
    expect(plan.action).toBe("skip");
    if (plan.action === "skip") {
      expect(plan.code).toBe("ALREADY_COMPLETE");
    }
  });

  it("does not overwrite explicit weekly MasterAdmin approvals", () => {
    const approvals = [
      {
        store_number: "2587",
        week_label: "2026-W44",
        week_starting: "2026-10-26",
        specialist_id: "nate",
        approved_capacity: 2,
        schedule_fingerprint: LIVE_FP.nate!,
        approved_by_specialist_id: "master",
        approved_at: "2026-10-18T00:00:00.000Z",
      },
    ];
    const provenance = new Map<string, ApprovalProvenanceRow>([
      [
        "nate",
        {
          store_number: "2587",
          week_label: "2026-W44",
          specialist_id: "nate",
          source: STANDING_CAPACITY_SOURCE_EXPLICIT,
          standing_policy_id: null,
          materialized_at: null,
        },
      ],
    ]);
    const plan = planStandingCapacityMaterialization({
      store_number: "2587",
      week_label: "2026-W44",
      policy: POLICY,
      eligible_specialist_ids: ELIGIBLE,
      existing_approvals: approvals,
      provenance_by_specialist: provenance,
      live_fingerprints: LIVE_FP,
      owned_by_specialist: {},
      owned_total: 0,
    });
    expect(plan.action).toBe("write");
    if (plan.action === "write") {
      expect(plan.items.some((i) => i.specialist_id === "nate")).toBe(false);
      expect(plan.items).toHaveLength(3);
    }
  });

  it("treats legacy approvals without provenance as explicit (no overwrite)", () => {
    const approvals = ELIGIBLE.map((sid) => ({
      store_number: "2587",
      week_label: "2026-W43",
      week_starting: "2026-10-19",
      specialist_id: sid,
      approved_capacity: 3,
      schedule_fingerprint: LIVE_FP[sid]!,
      approved_by_specialist_id: "master",
      approved_at: "2026-10-17T00:00:00.000Z",
    }));
    const plan = planStandingCapacityMaterialization({
      store_number: "2587",
      week_label: "2026-W43",
      policy: POLICY,
      eligible_specialist_ids: ELIGIBLE,
      existing_approvals: approvals,
      provenance_by_specialist: new Map(),
      live_fingerprints: LIVE_FP,
      owned_by_specialist: {},
      owned_total: 0,
    });
    expect(plan.action).toBe("skip");
  });

  it("protects published weeks with owned assignments", () => {
    const plan = planStandingCapacityMaterialization({
      store_number: "2587",
      week_label: "2026-W43",
      policy: POLICY,
      eligible_specialist_ids: ELIGIBLE,
      existing_approvals: [],
      provenance_by_specialist: new Map(),
      live_fingerprints: LIVE_FP,
      owned_by_specialist: { tyson: 3, nate: 3, nick: 3, tracy: 3 },
      owned_total: 12,
    });
    expect(plan.action).toBe("skip");
    if (plan.action === "skip") {
      expect(plan.code).toBe("PUBLISHED_WEEK_PROTECTED");
    }
  });

  it("fails when policy omits an eligible associate", () => {
    const incomplete: StandingCapacityPolicy = {
      ...POLICY,
      items: POLICY.items.filter((i) => i.specialist_id !== "tracy"),
    };
    const plan = planStandingCapacityMaterialization({
      store_number: "2587",
      week_label: "2026-W44",
      policy: incomplete,
      eligible_specialist_ids: ELIGIBLE,
      existing_approvals: [],
      provenance_by_specialist: new Map(),
      live_fingerprints: LIVE_FP,
      owned_by_specialist: {},
      owned_total: 0,
    });
    expect(plan.action).toBe("fail");
    if (plan.action === "fail") {
      expect(plan.code).toBe("STANDING_CAPACITY_INCOMPLETE");
    }
  });

  it("policy change is prospective — rematerializes standing rows with new caps", () => {
    const oldApprovals = ELIGIBLE.map((sid) => ({
      store_number: "2587",
      week_label: "2026-W44",
      week_starting: "2026-10-26",
      specialist_id: sid,
      approved_capacity: 3,
      schedule_fingerprint: LIVE_FP[sid]!,
      approved_by_specialist_id: "master",
      approved_at: "2026-10-18T00:00:00.000Z",
    }));
    const provenance = new Map<string, ApprovalProvenanceRow>(
      ELIGIBLE.map((sid) => [
        sid,
        {
          store_number: "2587",
          week_label: "2026-W44",
          specialist_id: sid,
          source: STANDING_CAPACITY_SOURCE_STANDING,
          standing_policy_id: "policy-v1",
          materialized_at: "2026-10-18T00:00:00.000Z",
        },
      ])
    );
    const nextPolicy: StandingCapacityPolicy = {
      ...POLICY,
      id: "policy-v2",
      policy_version: 2,
      items: [
        { specialist_id: "tyson", approved_capacity: 3 },
        { specialist_id: "nate", approved_capacity: 2 },
        { specialist_id: "nick", approved_capacity: 3 },
        { specialist_id: "tracy", approved_capacity: 3 },
      ],
    };
    const plan = planStandingCapacityMaterialization({
      store_number: "2587",
      week_label: "2026-W44",
      policy: nextPolicy,
      eligible_specialist_ids: ELIGIBLE,
      existing_approvals: oldApprovals,
      provenance_by_specialist: provenance,
      live_fingerprints: LIVE_FP,
      owned_by_specialist: {},
      owned_total: 0,
    });
    expect(plan.action).toBe("write");
    if (plan.action === "write") {
      expect(plan.policy_id).toBe("policy-v2");
      const nate = plan.items.find((i) => i.specialist_id === "nate");
      expect(nate?.approved_capacity).toBe(2);
    }
  });

  it("zero-shift fingerprints still allow 3/3/3/3 materialization", () => {
    const plan = planStandingCapacityMaterialization({
      store_number: "2587",
      week_label: "2026-W44",
      policy: POLICY,
      eligible_specialist_ids: ELIGIBLE,
      existing_approvals: [],
      provenance_by_specialist: new Map(),
      live_fingerprints: LIVE_FP,
      owned_by_specialist: {},
      owned_total: 0,
    });
    expect(plan.action).toBe("write");
    if (plan.action === "write") {
      const snap = composeApprovedStoreWeekCapacity({
        store_number: "2587",
        week_label: "2026-W44",
        approved_by_specialist: Object.fromEntries(
          plan.items.map((i) => [i.specialist_id, i.approved_capacity])
        ),
        eligible_specialist_ids: [...ELIGIBLE],
        assignments: [],
      });
      expect(snap.approvals_complete).toBe(true);
      expect(snap.shared_target).toBe(12);
    }
  });
});

describe("AUTO-008A contracts — latch off, no parallel capacity system", () => {
  it("keeps WEEKLY_ROTATION_AUTO_PUBLISH hard-off", () => {
    expect(WEEKLY_ROTATION_AUTO_PUBLISH).toBe(false);
  });

  it("wires Sunday dispatch to standing materialization", () => {
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(dispatch).toMatch(/materializeStandingCapacityForWeek/);
    expect(dispatch).toMatch(/loadActiveStandingCapacityPolicy/);
  });

  it("reuses existing weekly approval RPC writer", () => {
    const standing = readRepo("lib/store-ops/standing-week-capacity.ts");
    expect(standing).toMatch(/writeWeekCapacityApprovals/);
    expect(standing).not.toMatch(/upsert_sunday_bay_assignments/);
  });

  it("migration is additive and local-only marked", () => {
    const sql = readRepo(
      "supabase/migrations/20261025_rotation_auto_008a_standing_capacity.sql"
    );
    expect(sql).toMatch(/store_standing_capacity_policies/);
    expect(sql).toMatch(/store_week_capacity_approval_provenance/);
    expect(sql).toMatch(/do NOT apply to production/i);
    expect(sql).not.toMatch(/drop table public\.store_week_capacity_approvals/i);
  });

  it("MasterAdmin API requires requireSuperAdmin on write", () => {
    const route = readRepo("app/api/standing-capacity/route.ts");
    expect(route).toMatch(/requireSuperAdmin/);
    expect(route).toMatch(/establishStandingCapacityPolicy/);
    expect(route).toMatch(/revokeActiveStandingCapacityPolicy/);
  });

  it("explicit week approve stamps explicit provenance", () => {
    const route = readRepo("app/api/week-capacity/route.ts");
    expect(route).toMatch(/STANDING_CAPACITY_SOURCE_EXPLICIT/);
    expect(route).toMatch(/recordWeekCapacityApprovalProvenance/);
  });
});
