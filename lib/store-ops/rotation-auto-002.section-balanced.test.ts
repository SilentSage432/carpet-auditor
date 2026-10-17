/**
 * DEPTSYNC-ROTATION-AUTO-002 — section-balanced stage + authoritative path.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  WEEKLY_ROTATION_AUTO_PUBLISH,
  composeAuthoritativeAssignmentProposal,
  isWeeklyRotationAutoPublishEnabled,
} from "./authoritative-week-cycle";
import {
  explainFlatStageOwnershipGap,
  selectSectionBalancedPhysicalBayCoverage,
} from "./section-balanced-stage";
import type { BaySectionLookup } from "./operational-sections";
import type { StoreLocation } from "./types";
import { STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE } from "./stewardship-week-distribution";
import { STRICT_SECTION_OWNERSHIP_AUTO_STAGE } from "./section-ownership-enforcement";
import { SECTION_AWARE_ROTATION_AUTO_STAGE } from "./section-aware-rotation";

function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function loc(
  id: string,
  aisle: string,
  bay: number,
  extras: Partial<StoreLocation> = {}
): StoreLocation {
  return {
    id,
    department_id: "dept-floor",
    store_id: "store-1",
    store_number: "2587",
    aisle,
    bay,
    type: "SELLING",
    location_type: "STANDARD",
    is_active: true,
    status: "PENDING",
    ...extras,
  } as StoreLocation;
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

/** W42 geometry from AUTO-001 discovery (Nate CSA over-staged). */
const W42_MEMBERSHIPS = [
  { aisle: "7", bay: 9, owner: "nate", section: "CSA" },
  { aisle: "39", bay: 10, owner: "nate", section: "CSA" },
  { aisle: "40", bay: 15, owner: "nate", section: "CSA" },
  { aisle: "39", bay: 11, owner: "nate", section: "CSA" },
  { aisle: "7", bay: 13, owner: "nate", section: "CSA" },
  { aisle: "44", bay: 6, owner: "nick", section: "Specialist-A" },
  { aisle: "44", bay: 11, owner: "nick", section: "Specialist-A" },
  { aisle: "41", bay: 19, owner: "tracy", section: "Specialist-B" },
  { aisle: "41", bay: 10, owner: "tracy", section: "Specialist-B" },
  { aisle: "6", bay: 2, owner: "tyson", section: "Myself" },
  { aisle: "6", bay: 18, owner: "tyson", section: "Myself" },
  // Extra owed bays so balanced stage can fill Tyson/Nick/Tracy to 3
  { aisle: "44", bay: 1, owner: "nick", section: "Specialist-A" },
  { aisle: "41", bay: 1, owner: "tracy", section: "Specialist-B" },
  { aisle: "6", bay: 1, owner: "tyson", section: "Myself" },
  { aisle: "5", bay: 1, owner: "tyson", section: "Myself" },
  { aisle: "43", bay: 1, owner: "nick", section: "Specialist-A" },
  { aisle: "42", bay: 1, owner: "tracy", section: "Specialist-B" },
];

describe("ROTATION-AUTO-002 section-balanced stage", () => {
  it("reproduces W42 8/11 flat-stage ownership gap (AUTO-001 root cause)", () => {
    const stagedKeysByOwner = new Map<string, string[]>([
      ["nate", ["7-9", "39-10", "40-15", "39-11", "7-13"]],
      ["nick", ["44-6", "44-11"]],
      ["tracy", ["41-19", "41-10"]],
      ["tyson", ["6-2", "6-18"]],
    ]);
    const caps = new Map([
      ["tyson", 3],
      ["nate", 2],
      ["nick", 3],
      ["tracy", 3],
    ]);
    const gap = explainFlatStageOwnershipGap({
      stagedKeysByOwner,
      approvedCapacityByOwner: caps,
      ownerNames: new Map([
        ["nate", "Nate"],
        ["nick", "Nick"],
        ["tracy", "Tracy"],
        ["tyson", "Tyson"],
      ]),
    });
    expect(gap.approved_sum).toBe(11);
    expect(gap.achievable_owned).toBe(8);
    expect(gap.unownable_staged).toBe(3);
    expect(gap.per_owner.find((p) => p.specialist_id === "nate")?.leftover_staged).toBe(
      3
    );
  });

  it("balanced selection fills approved capacity when eligible bays exist", () => {
    const baySectionByKey = sectionMap(W42_MEMBERSHIPS);
    const pending = W42_MEMBERSHIPS.map((m, i) =>
      loc(`loc-${i}`, m.aisle, m.bay)
    );
    const result = selectSectionBalancedPhysicalBayCoverage({
      pending,
      carried: [],
      baySectionByKey,
      slots: [
        { specialist_id: "tyson", specialist_name: "Tyson", capacity: 3 },
        { specialist_id: "nate", specialist_name: "Nate", capacity: 2 },
        { specialist_id: "nick", specialist_name: "Nick", capacity: 3 },
        { specialist_id: "tracy", specialist_name: "Tracy", capacity: 3 },
      ],
    });
    expect(result.mode).toBe("section_balanced");
    expect(result.selected_total).toBe(11);
    expect(result.requested_total).toBe(11);
    expect(result.shortfalls.filter((s) => s.unfilled > 0)).toHaveLength(0);

    const byOwner = new Map<string, number>();
    for (const row of result.selected) {
      const owner = baySectionByKey.get(row.key)?.primary_owner_specialist_id;
      byOwner.set(owner!, (byOwner.get(owner!) ?? 0) + 1);
    }
    expect(byOwner.get("nate")).toBe(2);
    expect(byOwner.get("nick")).toBe(3);
    expect(byOwner.get("tracy")).toBe(3);
    expect(byOwner.get("tyson")).toBe(3);
  });

  it("never stages a bay into another associate's section", () => {
    const baySectionByKey = sectionMap([
      { aisle: "7", bay: 1, owner: "nate", section: "CSA" },
      { aisle: "7", bay: 2, owner: "nate", section: "CSA" },
      { aisle: "7", bay: 3, owner: "nate", section: "CSA" },
      { aisle: "6", bay: 1, owner: "tyson", section: "Myself" },
    ]);
    const pending = [
      loc("a", "7", 1),
      loc("b", "7", 2),
      loc("c", "7", 3),
      loc("d", "6", 1),
    ];
    const result = selectSectionBalancedPhysicalBayCoverage({
      pending,
      carried: [],
      baySectionByKey,
      slots: [
        { specialist_id: "tyson", specialist_name: "Tyson", capacity: 3 },
        { specialist_id: "nate", specialist_name: "Nate", capacity: 2 },
      ],
    });
    expect(result.selected_total).toBe(3); // nate 2 + tyson 1
    for (const row of result.selected) {
      const owner = baySectionByKey.get(row.key)?.primary_owner_specialist_id;
      if (row.key.includes("|6|")) expect(owner).toBe("tyson");
      if (row.key.includes("|7|")) expect(owner).toBe("nate");
    }
    const tysonShort = result.shortfalls.find((s) => s.specialist_id === "tyson");
    expect(tysonShort?.unfilled).toBe(2);
    expect(tysonShort?.code).toBe("insufficient_eligible_bays");
  });

  it("reports insufficient eligible candidates explicitly", () => {
    const baySectionByKey = sectionMap([
      { aisle: "6", bay: 1, owner: "tyson", section: "Myself" },
    ]);
    const result = selectSectionBalancedPhysicalBayCoverage({
      pending: [loc("only", "6", 1)],
      carried: [],
      baySectionByKey,
      slots: [{ specialist_id: "tyson", specialist_name: "Tyson", capacity: 3 }],
    });
    expect(result.selected_total).toBe(1);
    expect(result.shortfalls[0]?.code).toBe("insufficient_eligible_bays");
    expect(result.shortfalls[0]?.unfilled).toBe(2);
  });

  it("reports no_section when associate has capacity but no owned owed bays", () => {
    const baySectionByKey = sectionMap([
      { aisle: "6", bay: 1, owner: "tyson", section: "Myself" },
    ]);
    const result = selectSectionBalancedPhysicalBayCoverage({
      pending: [loc("only", "6", 1)],
      carried: [],
      baySectionByKey,
      slots: [
        { specialist_id: "tyson", specialist_name: "Tyson", capacity: 1 },
        { specialist_id: "nate", specialist_name: "Nate", capacity: 2 },
      ],
    });
    const nate = result.shortfalls.find((s) => s.specialist_id === "nate");
    expect(nate?.code).toBe("no_section");
    expect(nate?.unfilled).toBe(2);
  });

  it("excludes SHOWROOM_STACKOUT from selection via physical-bay eligibility", () => {
    const baySectionByKey = sectionMap([
      { aisle: "6", bay: 1, owner: "tyson", section: "Myself" },
      { aisle: "6", bay: 2, owner: "tyson", section: "Myself" },
    ]);
    const result = selectSectionBalancedPhysicalBayCoverage({
      pending: [
        loc("a", "6", 1),
        loc("b", "6", 2, { location_type: "SHOWROOM_STACKOUT" }),
      ],
      carried: [],
      baySectionByKey,
      slots: [{ specialist_id: "tyson", specialist_name: "Tyson", capacity: 2 }],
    });
    expect(result.selected_total).toBe(1);
    expect(result.selected[0]?.key).toBe("dept-floor|6|1");
  });
});

describe("ROTATION-AUTO-002 authoritative assign + auto-publish gate", () => {
  it("keeps auto-publish hard-off", () => {
    expect(WEEKLY_ROTATION_AUTO_PUBLISH).toBe(false);
    expect(isWeeklyRotationAutoPublishEnabled()).toBe(false);
    expect(isWeeklyRotationAutoPublishEnabled(true)).toBe(true);
    expect(STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE).toBe(false);
    expect(STRICT_SECTION_OWNERSHIP_AUTO_STAGE).toBe(false);
    expect(SECTION_AWARE_ROTATION_AUTO_STAGE).toBe(false);
  });

  it("composeAuthoritativeAssignmentProposal skips already-owned rotations (edit-safe retry)", () => {
    const baySectionByKey = sectionMap([
      { aisle: "6", bay: 1, owner: "tyson", section: "Myself" },
      { aisle: "6", bay: 2, owner: "tyson", section: "Myself" },
      { aisle: "6", bay: 3, owner: "tyson", section: "Myself" },
    ]);
    const capacity = {
      shared_target: 3,
      owned_total: 1,
      remaining_shared: 2,
      remaining_by_specialist: { tyson: 2 },
      eligible_specialist_ids: ["tyson"],
      eligible_count: 1,
      approvals_complete: true,
      approved_by_specialist: { tyson: 3 },
      quota_per_person: 3,
      owned_by_specialist: { tyson: 1 },
      over_capacity: false,
      store_number: "2587",
      week_label: "2026-W42",
      week_starting: "2026-10-12",
    };
    const proposal = composeAuthoritativeAssignmentProposal({
      store_number: "2587",
      week_label: "2026-W42",
      staged: [
        { id: "rot-owned", department_id: "dept-floor", aisle: "6", bay: 1 },
        { id: "rot-a", department_id: "dept-floor", aisle: "6", bay: 2 },
        { id: "rot-b", department_id: "dept-floor", aisle: "6", bay: 3 },
      ],
      ownedRotationIds: new Set(["rot-owned"]),
      members: [
        {
          specialist_id: "tyson",
          specialist_name: "Tyson",
          active: true,
          hours: 40,
        },
      ],
      baySectionByKey,
      capacity: capacity as never,
    });
    expect(proposal.actionable).toBe(true);
    const ids = proposal.items.map((i) => i.rotationId).sort();
    expect(ids).toEqual(["rot-a", "rot-b"]);
    expect(ids).not.toContain("rot-owned");
  });

  it("blocks proposal on missing approvals", () => {
    expect(() =>
      composeAuthoritativeAssignmentProposal({
        store_number: "2587",
        week_label: "2026-W42",
        staged: [
          { id: "r1", department_id: "dept-floor", aisle: "6", bay: 1 },
        ],
        ownedRotationIds: [],
        members: [
          {
            specialist_id: "tyson",
            specialist_name: "Tyson",
            active: true,
            hours: 40,
          },
        ],
        baySectionByKey: sectionMap([
          { aisle: "6", bay: 1, owner: "tyson", section: "Myself" },
        ]),
        capacity: {
          shared_target: 3,
          owned_total: 0,
          remaining_shared: 3,
          remaining_by_specialist: { tyson: 3 },
          eligible_specialist_ids: ["tyson"],
          approvals_complete: false,
          approved_by_specialist: {},
          quota_per_person: 3,
          owned_by_specialist: {},
          over_capacity: false,
          store_number: "2587",
          week_label: "2026-W42",
        } as never,
      })
    ).toThrow(/approv/i);
  });
});

describe("ROTATION-AUTO-002 source contracts", () => {
  it("generateWeeklyRotations prefers section-balanced stage when context exists", () => {
    const rotations = readRepo("lib/store-ops/rotations.ts");
    expect(rotations).toMatch(/loadAuthoritativeStageContext/);
    expect(rotations).toMatch(/runSectionBalancedStageSelection/);
    expect(rotations).toMatch(/selectPhysicalBayCoverage/);
  });

  it("sunday-dispatch uses stewardship assign path and auto-publish OFF", () => {
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(dispatch).toMatch(/composeAuthoritativeAssignmentProposal/);
    expect(dispatch).toMatch(/WEEKLY_ROTATION_AUTO_PUBLISH/);
    expect(dispatch).toMatch(/STAGED_AWAITING_ASSIGN/);
    expect(dispatch).not.toMatch(/planFlatBayAssignmentsWithCaps/);
    expect(dispatch).toMatch(/WEEKLY_ROTATION_AUTO_PUBLISH = false|WEEKLY_ROTATION_AUTO_PUBLISH/);
  });

  it("manual Assign this week still uses stewardship composer", () => {
    const modal = readRepo("components/admin/SundayAuditAssignmentModal.tsx");
    expect(modal).toMatch(/composeStewardshipWeeklyProposal/);
    expect(modal).toMatch(/handleBalanceAssign/);
  });

  it("auto-publish constant is false in authoritative module", () => {
    const src = readRepo("lib/store-ops/authoritative-week-cycle.ts");
    expect(src).toMatch(
      /export const WEEKLY_ROTATION_AUTO_PUBLISH(?:: boolean)? = false/
    );
  });
});
