/**
 * DEPTSYNC-MAP-003 — week-scoped supervisory bay priority.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPreviewCapacityCaps } from "./section-aware-rotation";
import {
  classifyBayPriorityTier,
  composeStewardshipWeeklyProposal,
} from "./stewardship-week-distribution";
import {
  addIsoWeeks,
  isoWeekLabel,
  resolveNextRotationWeekLabel,
} from "./week";
import {
  buildWeekBayPriorityDigest,
  evaluateWeekBayPriorityOutcomes,
  weekBayPriorityPhysicalKey,
  type WeekBayPriorityView,
} from "./week-bay-priority";
import type { BaySectionLookup } from "./operational-sections";
import type { ShiftRosterMember } from "./weekly-rotations";

const root = join(__dirname, "../..");

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const DEPT = "dept-flooring";

function section(
  aisle: string,
  bay: number,
  owner: string,
  sectionId = "sec-a",
  sectionName = "Section A"
): [string, BaySectionLookup] {
  const key = weekBayPriorityPhysicalKey({
    department_id: DEPT,
    aisle,
    bay,
  });
  return [
    key,
    {
      section_id: sectionId,
      section_name: sectionName,
      department_id: DEPT,
      primary_owner_specialist_id: owner,
      primary_owner_name: owner,
      is_active: true,
    },
  ];
}

function priority(
  aisle: string,
  bay: number,
  owner: string,
  overrides?: Partial<WeekBayPriorityView>
): WeekBayPriorityView {
  return {
    id: `prio-${aisle}-${bay}`,
    store_id: "store-1",
    store_number: "2587",
    week_label: "2026-W43",
    week_starting: "2026-10-19",
    department_id: DEPT,
    aisle,
    bay,
    section_id: "sec-a",
    section_name: "Section A",
    owner_specialist_id: owner,
    prioritized_by_specialist_id: "supervisor-1",
    created_at: "2026-10-12T12:00:00.000Z",
    revoked_at: null,
    revoked_by_specialist_id: null,
    physical_key: weekBayPriorityPhysicalKey({
      department_id: DEPT,
      aisle,
      bay,
    }),
    active: true,
    ...overrides,
  };
}

const members: ShiftRosterMember[] = [
  {
    specialist_id: "tyson",
    specialist_name: "Tyson",
    hours: 40,
    active: true,
  },
  {
    specialist_id: "nate",
    specialist_name: "Nate",
    hours: 40,
    active: true,
  },
];

describe("MAP-003 week helpers", () => {
  it("next rotation week is current ISO week + 1", () => {
    const current = isoWeekLabel(new Date("2026-10-13T12:00:00Z"));
    expect(resolveNextRotationWeekLabel(new Date("2026-10-13T12:00:00Z"))).toBe(
      addIsoWeeks(current, 1)
    );
  });

  it("priority digest is deterministic and week-scoped keys sort", () => {
    const a = priority("5", 1, "tyson");
    const b = priority("5", 2, "tyson");
    expect(buildWeekBayPriorityDigest([b, a])).toBe(
      buildWeekBayPriorityDigest([a, b])
    );
  });
});

describe("MAP-003 evaluateWeekBayPriorityOutcomes", () => {
  it("marks included vs capacity-exhausted vs not staged", () => {
    const map = new Map<string, BaySectionLookup>([
      section("5", 1, "tyson"),
      section("5", 2, "tyson"),
      section("5", 3, "tyson"),
    ]);
    const priorities = [
      priority("5", 1, "tyson"),
      priority("5", 2, "tyson"),
      priority("5", 3, "tyson"),
    ];
    const outcomes = evaluateWeekBayPriorityOutcomes({
      week_label: "2026-W43",
      priorities,
      baySectionByKey: map,
      stagedPhysicalKeys: [
        weekBayPriorityPhysicalKey({ department_id: DEPT, aisle: "5", bay: 1 }),
        weekBayPriorityPhysicalKey({ department_id: DEPT, aisle: "5", bay: 2 }),
      ],
      proposedPhysicalKeys: [
        weekBayPriorityPhysicalKey({ department_id: DEPT, aisle: "5", bay: 1 }),
      ],
      remainingBySpecialist: { tyson: 1 },
      proposedBySpecialist: { tyson: 1 },
      eligibleSpecialistIds: ["tyson"],
      memberNamesById: { tyson: "Tyson" },
    });
    expect(outcomes.find((o) => o.bay === 1)?.status).toBe(
      "included_in_proposal"
    );
    expect(outcomes.find((o) => o.bay === 2)?.reason_code).toBe(
      "capacity_exhausted"
    );
    expect(outcomes.find((o) => o.bay === 3)?.reason_code).toBe(
      "capacity_exhausted"
    );
  });

  it("explains ownership missing and already assigned", () => {
    const map = new Map<string, BaySectionLookup>([section("5", 1, "tyson")]);
    const outcomes = evaluateWeekBayPriorityOutcomes({
      week_label: "2026-W43",
      priorities: [
        priority("5", 1, "tyson"),
        priority("99", 1, "tyson", {
          section_id: null,
          section_name: null,
          owner_specialist_id: null,
        }),
      ],
      baySectionByKey: map,
      stagedPhysicalKeys: [
        weekBayPriorityPhysicalKey({ department_id: DEPT, aisle: "5", bay: 1 }),
      ],
      assignedPhysicalKeys: [
        weekBayPriorityPhysicalKey({ department_id: DEPT, aisle: "5", bay: 1 }),
      ],
      proposedPhysicalKeys: [],
      remainingBySpecialist: { tyson: 3 },
      eligibleSpecialistIds: ["tyson"],
    });
    expect(outcomes.find((o) => o.bay === 1)?.status).toBe("already_assigned");
    expect(outcomes.find((o) => o.aisle === "99")?.reason_code).toBe(
      "ownership_missing"
    );
  });

  it("detects ownership change after priority", () => {
    const map = new Map<string, BaySectionLookup>([
      section("5", 1, "nate"), // live owner changed
    ]);
    const outcomes = evaluateWeekBayPriorityOutcomes({
      week_label: "2026-W43",
      priorities: [priority("5", 1, "tyson")],
      baySectionByKey: map,
      stagedPhysicalKeys: [
        weekBayPriorityPhysicalKey({ department_id: DEPT, aisle: "5", bay: 1 }),
      ],
      proposedPhysicalKeys: [],
      remainingBySpecialist: { nate: 3, tyson: 3 },
      eligibleSpecialistIds: ["nate", "tyson"],
    });
    expect(outcomes[0]?.reason_code).toBe("owner_changed");
  });
});

describe("MAP-003 proposal preferential consideration", () => {
  it("prefers supervisor-prioritized bay within owned section capacity", () => {
    const sections = new Map<string, BaySectionLookup>([
      section("5", 1, "tyson"),
      section("5", 2, "tyson"),
      section("5", 3, "tyson"),
    ]);
    const bays = [1, 2, 3].map((bay) => ({
      rotationId: `rot-5-${bay}`,
      department_id: DEPT,
      aisle: "5",
      bay,
      riskScore: 0,
    }));
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["tyson"],
      ownedBySpecialist: {},
      ownedTotal: 0,
      approvedBySpecialist: { tyson: 1 },
    });
    const priorities = [priority("5", 3, "tyson")];
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W43",
      tiers: classifyBayPriorityTier(bays),
      bays,
      members: [members[0]!],
      baySectionByKey: sections,
      capacity,
      supervisorPriorities: priorities,
    });
    expect(proposal.actionable).toBe(true);
    expect(proposal.items).toHaveLength(1);
    expect(proposal.items[0]?.bay).toBe(3);
    expect(proposal.items[0]?.priority_tier).toBe("supervisor");
    expect(proposal.items[0]?.explanation.codes).toContain(
      "supervisor_week_priority"
    );
    expect(proposal.supervisor_priorities[0]?.status).toBe(
      "included_in_proposal"
    );
  });

  it("does not invent cross-section fill for excess priorities", () => {
    const sections = new Map<string, BaySectionLookup>([
      section("5", 1, "tyson"),
      section("5", 2, "tyson"),
      section("7", 1, "nate", "sec-b", "Section B"),
    ]);
    const bays = [
      {
        rotationId: "rot-5-1",
        department_id: DEPT,
        aisle: "5",
        bay: 1,
        riskScore: 0,
      },
      {
        rotationId: "rot-5-2",
        department_id: DEPT,
        aisle: "5",
        bay: 2,
        riskScore: 0,
      },
      {
        rotationId: "rot-7-1",
        department_id: DEPT,
        aisle: "7",
        bay: 1,
        riskScore: 0,
      },
    ];
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["tyson"],
      ownedBySpecialist: {},
      ownedTotal: 0,
      approvedBySpecialist: { tyson: 1 },
    });
    // Two priorities for Tyson (over capacity) + one in Nate's section.
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W43",
      tiers: classifyBayPriorityTier(bays),
      bays,
      members: [members[0]!],
      baySectionByKey: sections,
      capacity,
      supervisorPriorities: [
        priority("5", 1, "tyson"),
        priority("5", 2, "tyson"),
        priority("7", 1, "nate", {
          section_id: "sec-b",
          section_name: "Section B",
        }),
      ],
    });
    expect(proposal.items).toHaveLength(1);
    expect(proposal.items[0]?.specialist_id).toBe("tyson");
    expect(proposal.items.every((i) => i.aisle !== "7")).toBe(true);
    const notIncluded = proposal.supervisor_priorities.filter(
      (p) => p.status === "not_included"
    );
    expect(notIncluded.length).toBeGreaterThanOrEqual(2);
    expect(
      notIncluded.some((p) => p.reason_code === "capacity_exhausted")
    ).toBe(true);
  });

  it("does not silently carry priorities into a different week_label", () => {
    const sections = new Map<string, BaySectionLookup>([
      section("5", 1, "tyson"),
    ]);
    const bays = [
      {
        rotationId: "rot-5-1",
        department_id: DEPT,
        aisle: "5",
        bay: 1,
        riskScore: 0,
      },
    ];
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["tyson"],
      ownedBySpecialist: {},
      ownedTotal: 0,
      approvedBySpecialist: { tyson: 1 },
    });
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W44",
      tiers: classifyBayPriorityTier(bays),
      bays,
      members: [members[0]!],
      baySectionByKey: sections,
      capacity,
      supervisorPriorities: [priority("5", 1, "tyson")], // week 43
    });
    expect(proposal.supervisor_priorities).toHaveLength(0);
    expect(proposal.supervisor_priority_digest).toBe("");
  });

  it("skips already-assigned prioritized bay", () => {
    const sections = new Map<string, BaySectionLookup>([
      section("5", 1, "tyson"),
      section("5", 2, "tyson"),
    ]);
    const bays = [1, 2].map((bay) => ({
      rotationId: `rot-5-${bay}`,
      department_id: DEPT,
      aisle: "5",
      bay,
      riskScore: 0,
    }));
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["tyson"],
      ownedBySpecialist: { tyson: 1 },
      ownedTotal: 1,
      approvedBySpecialist: { tyson: 2 },
    });
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W43",
      tiers: classifyBayPriorityTier(bays),
      bays,
      members: [members[0]!],
      baySectionByKey: sections,
      ownedRotationIds: ["rot-5-1"],
      capacity,
      supervisorPriorities: [priority("5", 1, "tyson")],
    });
    expect(proposal.items.every((i) => i.bay !== 1)).toBe(true);
    expect(proposal.supervisor_priorities[0]?.status).toBe("already_assigned");
  });
});

describe("MAP-003 contracts", () => {
  it("Map bay sheet exposes Prioritize for Next Week without assignment writes", () => {
    const sheet = readRepo("components/admin/WalkTheFloorSheet.tsx");
    expect(sheet).toMatch(/Prioritize for Next Week/);
    expect(sheet).toMatch(/map-bay-week-priority/);
    expect(sheet).toMatch(/prioritizeBayForNextWeek/);
    expect(sheet).toMatch(/revokeBayWeekPriority/);
    expect(sheet).not.toMatch(/from\("sunday_bay_assignments"\)\.insert/);
    expect(sheet).not.toMatch(/zebra-entry/);
  });

  it("Sunday proposal review distinguishes priority outcomes", () => {
    const modal = readRepo("components/admin/SundayAuditAssignmentModal.tsx");
    expect(modal).toMatch(/supervisor-week-priorities/);
    expect(modal).toMatch(/Included in proposal/);
    expect(modal).toMatch(/Not included/);
    expect(modal).toMatch(/supervisorPriorities/);
    expect(modal).toMatch(/Assign this week/);
  });

  it("API requires Supervisor/Master and store-scoped writes", () => {
    const api = readRepo("app/api/store-locations/week-bay-priority/route.ts");
    expect(api).toMatch(/requireSupervisorOrAdmin/);
    expect(api).toMatch(/assertActorCanAccessDepartmentId/);
    expect(api).toMatch(/prioritizeBayForWeek/);
    expect(api).toMatch(/revokeWeekBayPriority/);
  });

  it("migration is additive week-scoped and revocable", () => {
    const sql = readRepo(
      "supabase/migrations/20261019_map_003_week_bay_priorities.sql"
    );
    expect(sql).toMatch(/store_week_bay_priorities/);
    expect(sql).toMatch(/revoked_at/);
    expect(sql).toMatch(/store_week_bay_priorities_active_unique_idx/);
    expect(sql).toMatch(/do NOT apply to production/i);
    expect(sql).not.toMatch(/sunday_bay_assignments/);
  });

  it("auto-stage remains hard off", () => {
    const dist = readRepo("lib/store-ops/stewardship-week-distribution.ts");
    expect(dist).toMatch(
      /STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE = false/
    );
    expect(dist).toMatch(/supervisor/);
  });
});
