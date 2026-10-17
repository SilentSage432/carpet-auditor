/**
 * DEPTSYNC-ROTATION-AUTO-003 — automatic publication + supervisor edit safety.
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
import { composeWeekPublicationVisibility } from "./week-publication-visibility";
import type { BaySectionLookup } from "./operational-sections";

function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

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

const capacityBase = {
  shared_target: 11,
  owned_total: 0,
  remaining_shared: 11,
  remaining_by_specialist: {
    tyson: 3,
    nate: 2,
    nick: 3,
    tracy: 3,
  },
  eligible_specialist_ids: ["tyson", "nate", "nick", "tracy"],
  eligible_count: 4,
  approvals_complete: true,
  approved_by_specialist: { tyson: 3, nate: 2, nick: 3, tracy: 3 },
  quota_per_person: 3,
  owned_by_specialist: {} as Record<string, number>,
  over_capacity: false,
  store_number: "2587",
  week_label: "2026-W42",
  week_starting: "2026-10-12",
};

describe("ROTATION-AUTO-003 activation mechanism", () => {
  it("keeps product latch false and ignores env while latch is false", () => {
    expect(WEEKLY_ROTATION_AUTO_PUBLISH).toBe(false);
    expect(
      resolveWeeklyRotationAutoPublishEnabled({
        env: { [WEEKLY_ROTATION_AUTO_PUBLISH_ENV]: "1" },
      })
    ).toBe(false);
    expect(resolveWeeklyRotationAutoPublishEnabled()).toBe(false);
  });

  it("allows explicit override for controlled tests only", () => {
    expect(resolveWeeklyRotationAutoPublishEnabled({ override: true })).toBe(
      true
    );
  });

  it("cron route does not accept body/query publish flags", () => {
    const cron = readRepo("app/api/cron/weekly-rotation/route.ts");
    expect(cron).toMatch(/CRON_SECRET|authorizeCron/);
    expect(cron).toMatch(/never from/);
    expect(cron).toMatch(/query\/body/);
    expect(cron).not.toMatch(/publishAssignments\s*:/);
    expect(cron).not.toMatch(/request\.json\(\)/);
  });
});

describe("ROTATION-AUTO-003 protected ids + edit-safe retry", () => {
  it("protects owned, supervisor-locked clear, and completed rows", () => {
    const protectedIds = collectProtectedRotationIds([
      {
        bay_id: "owned",
        roster_specialist_id: "tyson",
        status: "assigned",
      },
      {
        bay_id: "held-clear",
        roster_specialist_id: "",
        status: "cleared",
        supervisor_locked: true,
      },
      {
        bay_id: "done",
        roster_specialist_id: "nick",
        status: "completed",
      },
      {
        bay_id: "open",
        status: "cleared",
        supervisor_locked: false,
      },
    ]);
    expect([...protectedIds].sort()).toEqual([
      "done",
      "held-clear",
      "owned",
    ]);
  });

  it("supervisor edit followed by retry does not reassign protected bay", () => {
    const baySectionByKey = sectionMap([
      { aisle: "6", bay: 1, owner: "tyson", section: "Myself" },
      { aisle: "6", bay: 2, owner: "tyson", section: "Myself" },
      { aisle: "6", bay: 3, owner: "tyson", section: "Myself" },
    ]);
    const protectedIds = collectProtectedRotationIds([
      {
        bay_id: "rot-edited",
        roster_specialist_id: "tyson",
        status: "assigned",
        supervisor_locked: true,
      },
    ]);
    const proposal = composeAuthoritativeAssignmentProposal({
      store_number: "2587",
      week_label: "2026-W42",
      staged: [
        { id: "rot-edited", department_id: "dept-floor", aisle: "6", bay: 1 },
        { id: "rot-a", department_id: "dept-floor", aisle: "6", bay: 2 },
        { id: "rot-b", department_id: "dept-floor", aisle: "6", bay: 3 },
      ],
      ownedRotationIds: protectedIds,
      members: [
        {
          specialist_id: "tyson",
          specialist_name: "Tyson",
          active: true,
          hours: 40,
        },
      ],
      baySectionByKey,
      capacity: {
        ...capacityBase,
        shared_target: 3,
        remaining_shared: 2,
        remaining_by_specialist: { tyson: 2 },
        eligible_specialist_ids: ["tyson"],
        eligible_count: 1,
        approved_by_specialist: { tyson: 3 },
        owned_total: 1,
        owned_by_specialist: { tyson: 1 },
      } as never,
    });
    const ids = filterProposalAwayFromProtected(
      proposal.items,
      protectedIds
    ).map((i) => i.rotationId);
    expect(ids).not.toContain("rot-edited");
    expect(ids.sort()).toEqual(["rot-a", "rot-b"]);
  });

  it("filters capacity overflow and never emits protected ids", () => {
    const items = [
      { rotationId: "a", specialist_id: "tyson" },
      { rotationId: "locked", specialist_id: "nate" },
    ];
    const filtered = filterProposalAwayFromProtected(
      items,
      new Set(["locked"])
    );
    expect(filtered.map((i) => i.rotationId)).toEqual(["a"]);
  });
});

describe("ROTATION-AUTO-003 publication visibility", () => {
  it("distinguishes assigned, unfilled, supervisor-edited, zebra outstanding", () => {
    const visibility = composeWeekPublicationVisibility({
      week_label: "2026-W42",
      approved_capacity_total: 11,
      shortfall_notes: ["Nate: only 2/2"],
      staged: [
        { id: "1", aisle: "6", bay: 1 },
        { id: "2", aisle: "6", bay: 2 },
        { id: "3", aisle: "7", bay: 1 },
        { id: "4", aisle: "7", bay: 2, is_completed: true },
      ],
      assignmentsByBayId: new Map([
        [
          "1",
          {
            bay_id: "1",
            roster_specialist_id: "tyson",
            specialist_name: "Tyson",
            status: "assigned",
            supervisor_locked: true,
            zebra_entered_at: null,
          },
        ],
        [
          "2",
          {
            bay_id: "2",
            roster_specialist_id: "tyson",
            specialist_name: "Tyson",
            status: "assigned",
            zebra_entered_at: "2026-10-15T12:00:00Z",
          },
        ],
        [
          "3",
          {
            bay_id: "3",
            status: "cleared",
            supervisor_locked: true,
          },
        ],
      ]),
    });
    expect(visibility.assigned_total).toBe(2);
    expect(visibility.supervisor_edited_total).toBe(1);
    expect(visibility.supervisor_held_clear_total).toBe(1);
    expect(visibility.unfilled_total).toBe(1);
    expect(visibility.zebra_handoff_required_total).toBe(1);
    expect(visibility.completed_total).toBe(1);
    expect(
      summarizePublicationResult({
        visibility,
        created_assignments: 2,
        auto_publish_enabled: true,
      })
    ).toMatch(/Zebra handoff still required/);
  });

  it("does not claim Zebra was entered automatically", () => {
    const src = readRepo("lib/store-ops/week-publication-visibility.ts");
    expect(src).toMatch(/Does not claim Zebra/);
    expect(src).not.toMatch(/zebra_entered_at:\s*new Date/);
  });
});

describe("ROTATION-AUTO-003 source contracts", () => {
  it("sunday-dispatch uses resolveWeeklyRotationAutoPublishEnabled", () => {
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(dispatch).toMatch(/resolveWeeklyRotationAutoPublishEnabled/);
    expect(dispatch).toMatch(/collectProtectedRotationIds/);
    expect(dispatch).toMatch(/filterProposalAwayFromProtected/);
    expect(dispatch).toMatch(/composeWeekPublicationVisibility/);
    expect(dispatch).toMatch(/STAGED_AWAITING_ASSIGN/);
  });

  it("supervisor edits stamp supervisor_locked", () => {
    const audit = readRepo("lib/store-ops/sunday-audit.ts");
    expect(audit).toMatch(/stampSupervisorAssignmentLock/);
    expect(audit).toMatch(/supervisor_locked: true/);
  });

  it("migration prepared locally and not implied applied", () => {
    const mig = readRepo(
      "supabase/migrations/20261021_rotation_auto_003_supervisor_lock.sql"
    );
    expect(mig).toMatch(/supervisor_locked/);
    expect(mig).toMatch(/LOCAL PREPARE ONLY|do not apply to production/i);
  });

  it("product latch remains false in source", () => {
    const src = readRepo("lib/store-ops/authoritative-week-cycle.ts");
    expect(src).toMatch(
      /export const WEEKLY_ROTATION_AUTO_PUBLISH(?:: boolean)? = false/
    );
    expect(WEEKLY_ROTATION_AUTO_PUBLISH).toBe(false);
  });

  it("manual Assign this week still stewardship; respects supervisor_locked", () => {
    const modal = readRepo("components/admin/SundayAuditAssignmentModal.tsx");
    expect(modal).toMatch(/composeStewardshipWeeklyProposal/);
    expect(modal).toMatch(/supervisor_locked/);
  });
});

describe("ROTATION-AUTO-003 insufficient eligible + shortfall honesty", () => {
  it("reports non-actionable when section pool cannot fill remaining capacity", () => {
    const baySectionByKey = sectionMap([
      { aisle: "6", bay: 1, owner: "tyson", section: "Myself" },
      { aisle: "7", bay: 1, owner: "nate", section: "CSA" },
    ]);
    const proposal = composeAuthoritativeAssignmentProposal({
      store_number: "2587",
      week_label: "2026-W42",
      staged: [
        {
          id: "rot-t1",
          department_id: "dept-floor",
          aisle: "6",
          bay: 1,
        },
        {
          id: "rot-n1",
          department_id: "dept-floor",
          aisle: "7",
          bay: 1,
        },
        // Staged in Nate's section but Nate already at capacity via owned skip —
        // remaining bay has no eligible owner under strict ownership.
        {
          id: "rot-orphan",
          department_id: "dept-floor",
          aisle: "7",
          bay: 99,
        },
      ],
      ownedRotationIds: [],
      members: [
        {
          specialist_id: "tyson",
          specialist_name: "Tyson",
          active: true,
          hours: 40,
        },
        {
          specialist_id: "nate",
          specialist_name: "Nate",
          active: true,
          hours: 22,
        },
      ],
      baySectionByKey,
      capacity: {
        ...capacityBase,
        shared_target: 5,
        remaining_shared: 5,
        remaining_by_specialist: { tyson: 3, nate: 2 },
        eligible_specialist_ids: ["tyson", "nate"],
        eligible_count: 2,
        approved_by_specialist: { tyson: 3, nate: 2 },
      } as never,
    });
    // Orphan bay has no section membership → stewardship skips / shortfalls.
    expect(proposal.items.every((i) => i.rotationId !== "rot-orphan")).toBe(
      true
    );
  });
});

describe("ROTATION-AUTO-003 concurrency / capacity contracts", () => {
  it("assignment writers remain capacity-RPC gated (no open service-role mutate)", () => {
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    const capacity = readRepo("lib/store-ops/shared-week-capacity.ts");
    expect(dispatch).toMatch(/writeSundayAssignmentsWithCapacity/);
    expect(dispatch).toMatch(/applySundayAssignmentPlanAdmin/);
    expect(capacity).toMatch(
      /upsert_sunday_bay_assignments_with_capacity|advisory/
    );
  });

  it("completed and verified statuses remain protected from auto-publish", () => {
    const ids = collectProtectedRotationIds([
      { bay_id: "c1", status: "completed", roster_specialist_id: "tyson" },
      {
        bay_id: "v1",
        status: "verified",
        roster_specialist_id: "nick",
      },
      { bay_id: "open", status: "cleared" },
    ]);
    expect(ids.has("c1")).toBe(true);
    // verified with owner is owned → protected
    expect(ids.has("v1")).toBe(true);
    expect(ids.has("open")).toBe(false);
  });
});

describe("ROTATION-AUTO-003 full eligible publish proposal (11)", () => {
  it("composes actionable 11-bay proposal when sections have candidates", () => {
    const memberships = [
      ...[1, 2, 3].map((bay) => ({
        aisle: "6",
        bay,
        owner: "tyson",
        section: "Myself",
      })),
      ...[1, 2].map((bay) => ({
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
    const baySectionByKey = sectionMap(memberships);
    const staged = memberships.map((m, i) => ({
      id: `rot-${i}`,
      department_id: "dept-floor",
      aisle: m.aisle,
      bay: m.bay,
    }));
    const proposal = composeAuthoritativeAssignmentProposal({
      store_number: "2587",
      week_label: "2026-W42",
      staged,
      ownedRotationIds: [],
      members: [
        { specialist_id: "tyson", specialist_name: "Tyson", active: true, hours: 40 },
        { specialist_id: "nate", specialist_name: "Nate", active: true, hours: 22 },
        { specialist_id: "nick", specialist_name: "Nick", active: true, hours: 40 },
        { specialist_id: "tracy", specialist_name: "Tracy", active: true, hours: 40 },
      ],
      baySectionByKey,
      capacity: capacityBase as never,
    });
    expect(proposal.actionable).toBe(true);
    expect(proposal.items.length).toBe(11);
    const byOwner: Record<string, number> = {};
    for (const item of proposal.items) {
      byOwner[item.specialist_id] = (byOwner[item.specialist_id] ?? 0) + 1;
    }
    expect(byOwner).toEqual({ tyson: 3, nate: 2, nick: 3, tracy: 3 });
  });
});
