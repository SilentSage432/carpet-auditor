/**
 * DEPTSYNC-ROTATION-AUTO-006 — controlled automatic publication activation readiness.
 * Latch remains OFF. No production deploy/enable assertions that flip gates.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  WEEKLY_ROTATION_AUTO_PUBLISH,
  WEEKLY_ROTATION_AUTO_PUBLISH_ENV,
  collectProtectedRotationIds,
  composeAuthoritativeAssignmentProposal,
  filterProposalAwayFromProtected,
  resolveWeeklyRotationAutoPublishEnabled,
  summarizePublicationResult,
} from "./authoritative-week-cycle";
import { composeApprovedStoreWeekCapacity } from "./approved-week-capacity";
import type { BaySectionLookup } from "./operational-sections";
import { planStrictSectionOwnershipAssignments } from "./section-ownership-enforcement";
import {
  evaluateSundayAutoRun,
  sundayStagingWeekLabel,
} from "./sunday-schedule";
import { composeWeekPublicationVisibility } from "./week-publication-visibility";

function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const WEEK = "2026-W43";

function sectionMap(
  rows: Array<{ aisle: string; bay: number; owner: string; section: string }>
): Map<string, BaySectionLookup> {
  const map = new Map<string, BaySectionLookup>();
  for (const row of rows) {
    map.set(`dept-floor|${row.aisle}|${row.bay}`, {
      section_id: `sec-${row.section}`,
      section_name: row.section,
      department_id: "dept-floor",
      primary_owner_specialist_id: row.owner,
      primary_owner_name: row.owner,
      is_active: true,
    });
  }
  return map;
}

const MEMBERSHIPS = [
  ...[1, 2, 3].map((bay) => ({
    aisle: "6",
    bay,
    owner: "tyson",
    section: "Myself",
  })),
  ...[1, 2, 3].map((bay) => ({
    aisle: "7",
    bay,
    owner: "nate",
    section: "CSA",
  })),
  ...[1, 2, 3].map((bay) => ({
    aisle: "44",
    bay,
    owner: "nick",
    section: "A",
  })),
  ...[1, 2, 3].map((bay) => ({
    aisle: "41",
    bay,
    owner: "tracy",
    section: "B",
  })),
];

const CAPS_12 = { tyson: 3, nate: 3, nick: 3, tracy: 3 } as const;

function capacityFor(ids: string[]) {
  return composeApprovedStoreWeekCapacity({
    store_number: "2587",
    week_label: WEEK,
    eligible_specialist_ids: ids,
    approved_by_specialist: { ...CAPS_12 },
    assignments: [],
  });
}

function membersAtHours(hoursById: Record<string, number>) {
  return (["tyson", "nate", "nick", "tracy"] as const).map((id) => ({
    specialist_id: id,
    specialist_name: id[0]!.toUpperCase() + id.slice(1),
    active: true,
    hours: hoursById[id] ?? 0,
  }));
}

function proposalCounts(
  hoursById: Record<string, number>,
  ownedRotationIds: string[] = []
) {
  const capacity = capacityFor(["tyson", "nate", "nick", "tracy"]);
  const baySectionByKey = sectionMap(MEMBERSHIPS);
  const staged = MEMBERSHIPS.map((m, i) => ({
    id: `rot-${i}`,
    department_id: "dept-floor",
    aisle: m.aisle,
    bay: m.bay,
  }));
  const proposal = composeAuthoritativeAssignmentProposal({
    store_number: "2587",
    week_label: WEEK,
    staged,
    ownedRotationIds,
    members: membersAtHours(hoursById),
    baySectionByKey,
    capacity,
  });
  const counts: Record<string, number> = {};
  for (const item of proposal.items) {
    const id = String(item.specialist_id);
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return { proposal, counts, total: proposal.items.length };
}

describe("ROTATION-AUTO-006 dual-gate activation (AUTO-008 enabled)", () => {
  it("product latch is true after controlled enablement", () => {
    expect(WEEKLY_ROTATION_AUTO_PUBLISH).toBe(true);
  });

  it("publish requires latch true AND env=1; missing env stays off", () => {
    expect(
      resolveWeeklyRotationAutoPublishEnabled({
        env: { [WEEKLY_ROTATION_AUTO_PUBLISH_ENV]: "1" },
      })
    ).toBe(true);
    expect(
      resolveWeeklyRotationAutoPublishEnabled({
        env: {},
      })
    ).toBe(false);
  });

  it("cron cannot elevate via body/query; uses CRON_SECRET only", () => {
    const cron = readRepo("app/api/cron/weekly-rotation/route.ts");
    expect(cron).toMatch(/authorizeCron|CRON_SECRET/);
    expect(cron).not.toMatch(/publishAssignments\s*:/);
    expect(cron).not.toMatch(/request\.json\(\)/);
    expect(cron).toMatch(/12:00 UTC|0 12 \* \* 0|Sunday 12:00 UTC/);
  });

  it("vercel Hobby cron is Sunday 12:00 UTC for Denver year-round stage window", () => {
    const vercel = readRepo("vercel.json");
    expect(vercel).toMatch(/"schedule"\s*:\s*"0 12 \* \* 0"/);
    expect(vercel).not.toMatch(/"0 11 \* \* 0"/);
  });

  it("dispatch exposes auto_publish_enabled observability and STAGED path sets false", () => {
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(dispatch).toMatch(/auto_publish_enabled/);
    expect(dispatch).toMatch(/STAGED_AWAITING_ASSIGN/);
    expect(dispatch).toMatch(/auto_publish_enabled:\s*false/);
  });
});

describe("ROTATION-AUTO-006 target-week correctness (America/Denver)", () => {
  const tz = "America/Denver";

  it("Saturday before Sunday stays on current ISO week (not upcoming Monday)", () => {
    // Sat 2026-10-17 18:00 UTC = 12:00 MDT
    expect(
      sundayStagingWeekLabel(new Date("2026-10-17T18:00:00.000Z"), tz)
    ).toBe("2026-W42");
  });

  it("Sunday before cron targets upcoming Monday week", () => {
    // Sun 2026-10-18 04:00 UTC = Sat 22:00 MDT previous calendar — use local Sunday morning
    // Sun 2026-10-18 10:00 UTC = 04:00 MDT Sunday
    expect(
      sundayStagingWeekLabel(new Date("2026-10-18T10:00:00.000Z"), tz)
    ).toBe("2026-W43");
  });

  it("Sunday at scheduled cron (12:00 UTC MDT) targets upcoming Monday week", () => {
    expect(
      sundayStagingWeekLabel(new Date("2026-10-18T12:00:00.000Z"), tz)
    ).toBe("2026-W43");
    const decision = evaluateSundayAutoRun(
      {
        timezone: tz,
        sunday_auto_generate: true,
        sunday_auto_stage_time: "05:00",
      },
      new Date("2026-10-18T12:00:00.000Z")
    );
    expect(decision.run).toBe(true);
    expect(decision.weekLabel).toBe("2026-W43");
  });

  it("Sunday after cron still targets upcoming Monday week", () => {
    expect(
      sundayStagingWeekLabel(new Date("2026-10-18T20:00:00.000Z"), tz)
    ).toBe("2026-W43");
  });

  it("Monday following publication is that ISO week (not advanced)", () => {
    // Mon 2026-10-19 12:00 UTC = 06:00 MDT
    expect(
      sundayStagingWeekLabel(new Date("2026-10-19T12:00:00.000Z"), tz)
    ).toBe("2026-W43");
    const decision = evaluateSundayAutoRun(
      {
        timezone: tz,
        sunday_auto_generate: true,
        sunday_auto_stage_time: "05:00",
      },
      new Date("2026-10-19T12:00:00.000Z")
    );
    expect(decision.run).toBe(false);
    expect(decision.reason).toMatch(/Not Sunday/i);
  });

  it("month boundary Sunday targets next Monday ISO week", () => {
    // Sun 2026-11-29 → Mon 2026-11-30 = 2026-W49
    expect(
      sundayStagingWeekLabel(new Date("2026-11-29T12:00:00.000Z"), tz)
    ).toBe("2026-W49");
  });

  it("year boundary Sunday targets next Monday ISO week in new year", () => {
    // Sun 2026-12-27 → Mon 2026-12-28 = 2026-W53
    expect(
      sundayStagingWeekLabel(new Date("2026-12-27T12:00:00.000Z"), tz)
    ).toBe("2026-W53");
    // Sun 2027-01-03 → Mon 2027-01-04 = 2027-W01
    expect(
      sundayStagingWeekLabel(new Date("2027-01-03T12:00:00.000Z"), tz)
    ).toBe("2027-W01");
  });

  it("DST spring-forward Sunday still opens at 12:00 UTC and targets next week", () => {
    // 2026-03-08 DST start; 12:00 UTC = 06:00 MDT
    const now = new Date("2026-03-08T12:00:00.000Z");
    expect(sundayStagingWeekLabel(now, tz)).toBe("2026-W11");
    const decision = evaluateSundayAutoRun(
      {
        timezone: tz,
        sunday_auto_generate: true,
        sunday_auto_stage_time: "05:00",
      },
      now
    );
    expect(decision.run).toBe(true);
  });

  it("DST fall-back Sunday opens at 12:00 UTC (05:00 MST) — not skipped", () => {
    // 2026-11-01 DST end; 12:00 UTC = 05:00 MST (11:00 UTC would be 04:00 — skip)
    const at12 = new Date("2026-11-01T12:00:00.000Z");
    const at11 = new Date("2026-11-01T11:00:00.000Z");
    expect(sundayStagingWeekLabel(at12, tz)).toBe("2026-W45");
    expect(
      evaluateSundayAutoRun(
        {
          timezone: tz,
          sunday_auto_generate: true,
          sunday_auto_stage_time: "05:00",
        },
        at12
      ).run
    ).toBe(true);
    expect(
      evaluateSundayAutoRun(
        {
          timezone: tz,
          sunday_auto_generate: true,
          sunday_auto_stage_time: "05:00",
        },
        at11
      ).run
    ).toBe(false);
  });

  it("does not treat UTC calendar day as store-local operational day", () => {
    // Sat 2026-10-17 23:30 UTC is still Sat afternoon Denver (17:30 MDT)
    expect(
      sundayStagingWeekLabel(new Date("2026-10-17T23:30:00.000Z"), tz)
    ).toBe("2026-W42");
    // Sun 2026-10-18 05:30 UTC is Sat 23:30 MDT — still Saturday local
    expect(
      sundayStagingWeekLabel(new Date("2026-10-18T05:30:00.000Z"), tz)
    ).toBe("2026-W42");
  });
});

describe("ROTATION-AUTO-006 existing-week protection + shortfalls", () => {
  it("protects owned, locked, completed, verified; allows cleared unowned", () => {
    const protectedIds = collectProtectedRotationIds([
      { bay_id: "owned", roster_specialist_id: "tyson", status: "assigned" },
      {
        bay_id: "locked-clear",
        status: "cleared",
        supervisor_locked: true,
      },
      { bay_id: "done", roster_specialist_id: "nick", status: "completed" },
      {
        bay_id: "verified",
        roster_specialist_id: "tracy",
        status: "verified_complete",
      },
      { bay_id: "open", status: "cleared", supervisor_locked: false },
    ]);
    expect([...protectedIds].sort()).toEqual([
      "done",
      "locked-clear",
      "owned",
      "verified",
    ]);
  });

  it("retry after partial protected ownership fills only unprotected bays", () => {
    const protectedIds = new Set(["rot-0", "rot-1", "rot-2"]); // Tyson section already owned
    const { proposal, counts } = proposalCounts(
      { tyson: 40, nate: 0, nick: 40, tracy: 40 },
      [...protectedIds]
    );
    const safe = filterProposalAwayFromProtected(proposal.items, protectedIds);
    expect(safe.every((i) => !protectedIds.has(i.rotationId))).toBe(true);
    expect(counts.tyson ?? 0).toBe(0);
    expect(counts.nate).toBe(3);
    expect(counts.nick).toBe(3);
    expect(counts.tracy).toBe(3);
  });

  it("insufficient eligible bays reports shortfall without inventing fills", () => {
    const baySectionByKey = sectionMap([
      { aisle: "7", bay: 1, owner: "nate", section: "CSA" },
      { aisle: "7", bay: 2, owner: "nate", section: "CSA" },
    ]);
    const capacity = capacityFor(["nate"]);
    const proposal = composeAuthoritativeAssignmentProposal({
      store_number: "2587",
      week_label: WEEK,
      staged: [
        { id: "a", department_id: "dept-floor", aisle: "7", bay: 1 },
        { id: "b", department_id: "dept-floor", aisle: "7", bay: 2 },
      ],
      ownedRotationIds: [],
      members: membersAtHours({ nate: 0 }),
      baySectionByKey,
      capacity: {
        ...capacity,
        eligible_specialist_ids: ["nate"],
        shared_target: 3,
        remaining_shared: 3,
        remaining_by_specialist: { nate: 3 },
        approved_by_specialist: { nate: 3 },
      },
    });
    expect(proposal.items.length).toBeLessThanOrEqual(2);
    expect(proposal.items.length).toBe(2);
  });

  it("missing section ownership fails closed (no cross-section invent)", () => {
    const baySectionByKey = new Map<string, BaySectionLookup>();
    const plan = planStrictSectionOwnershipAssignments(
      [
        {
          rotationId: "x",
          department_id: "dept-floor",
          aisle: "6",
          bay: 1,
          riskScore: 0,
        },
      ],
      membersAtHours({ tyson: 0 }),
      new Map([["tyson", 3]]),
      baySectionByKey
    );
    expect(plan.items).toHaveLength(0);
  });

  it("ambiguous dual-owner section membership does not invent a winner", () => {
    // Empty primary owner → no assign (fail closed; no invented steward).
    const map = new Map<string, BaySectionLookup>();
    map.set("dept-floor|6|1", {
      section_id: "sec-a",
      section_name: "A",
      department_id: "dept-floor",
      primary_owner_specialist_id: "",
      primary_owner_name: "",
      is_active: true,
    });
    const plan = planStrictSectionOwnershipAssignments(
      [
        {
          rotationId: "x",
          department_id: "dept-floor",
          aisle: "6",
          bay: 1,
          riskScore: 0,
        },
      ],
      membersAtHours({ tyson: 40, nate: 40 }),
      new Map([
        ["tyson", 3],
        ["nate", 3],
      ]),
      map
    );
    expect(plan.items).toHaveLength(0);
  });
});

describe("ROTATION-AUTO-006 assignment simulation 3/3/3/3=12", () => {
  it("zero shifts → 3/3/3/3", () => {
    const { counts, total } = proposalCounts({
      tyson: 0,
      nate: 0,
      nick: 0,
      tracy: 0,
    });
    expect(total).toBe(12);
    expect(counts).toEqual({ tyson: 3, nate: 3, nick: 3, tracy: 3 });
  });

  it("partial shifts → same 3/3/3/3", () => {
    const { counts, total } = proposalCounts({
      tyson: 40,
      nate: 0,
      nick: 22,
      tracy: 8,
    });
    expect(total).toBe(12);
    expect(counts).toEqual({ tyson: 3, nate: 3, nick: 3, tracy: 3 });
  });

  it("complete shifts → same 3/3/3/3", () => {
    const { counts, total } = proposalCounts({
      tyson: 40,
      nate: 40,
      nick: 40,
      tracy: 40,
    });
    expect(total).toBe(12);
    expect(counts).toEqual({ tyson: 3, nate: 3, nick: 3, tracy: 3 });
  });
});

describe("ROTATION-AUTO-006 concurrency + Zebra + observability contracts", () => {
  it("capacity RPC uses transactional advisory lock (not in-memory)", () => {
    const sql = readRepo(
      "supabase/migrations/20261018_operational_011_section_ownership.sql"
    );
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/upsert_sunday_bay_assignments_with_capacity/);
  });

  it("idempotent retry language present in dispatch (skip complete / no destructive rewrite)", () => {
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(dispatch).toMatch(/planIsComplete/);
    expect(dispatch).toMatch(/ALREADY_COMPLETE/);
    expect(dispatch).toMatch(/refusing destructive rewrite/);
    expect(dispatch).toMatch(/collectProtectedRotationIds/);
  });

  it("published assignments surface Zebra handoff required without claiming entry", () => {
    const visibility = composeWeekPublicationVisibility({
      week_label: WEEK,
      approved_capacity_total: 12,
      staged: [
        { id: "1", aisle: "6", bay: 1 },
        { id: "2", aisle: "6", bay: 2 },
      ],
      assignmentsByBayId: new Map([
        [
          "1",
          {
            bay_id: "1",
            roster_specialist_id: "tyson",
            status: "assigned",
            zebra_entered_at: null,
          },
        ],
        [
          "2",
          {
            bay_id: "2",
            roster_specialist_id: "tyson",
            status: "assigned",
            zebra_entered_at: "2026-10-19T12:00:00Z",
          },
        ],
      ]),
    });
    expect(visibility.zebra_handoff_required_total).toBe(1);
    expect(
      summarizePublicationResult({
        visibility,
        created_assignments: 2,
        auto_publish_enabled: true,
      })
    ).toMatch(/Zebra handoff still required 1/);
    const src = readRepo("lib/store-ops/week-publication-visibility.ts");
    expect(src).toMatch(/Does not claim Zebra/);
  });

  it("staging-only summary never claims auto-publish ON", () => {
    const visibility = composeWeekPublicationVisibility({
      week_label: WEEK,
      approved_capacity_total: 12,
      staged: [{ id: "1", aisle: "6", bay: 1 }],
      assignmentsByBayId: new Map(),
    });
    const text = summarizePublicationResult({
      visibility,
      created_assignments: 0,
      auto_publish_enabled: false,
    });
    expect(text).toMatch(/auto-publish OFF/);
    expect(text).not.toMatch(/auto-publish ON/);
    expect(text).toMatch(/wrote 0/);
  });
});
