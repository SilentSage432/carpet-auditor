/**
 * DEPTSYNC-OPERATIONAL-011 — strict section ownership enforcement tests.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  findActiveBayMembershipConflicts,
  type BaySectionLookup,
} from "./operational-sections";
import {
  SECTION_AWARE_ROTATION_AUTO_STAGE,
  sectionAwarePhysicalKey,
} from "./section-aware-rotation";
import {
  STRICT_SECTION_OWNERSHIP_AUTO_STAGE,
  assertAssigneeOwnsBay,
  associateOwnsBay,
  buildSectionOwnershipDigest,
  inspectSectionOwnershipEvidence,
  selectBaysWithStrictSectionOwnership,
} from "./section-ownership-enforcement";
import {
  STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE,
  assertStewardshipProposalFresh,
  classifyBayPriorityTier,
  composeStewardshipWeeklyProposal,
} from "./stewardship-week-distribution";
import { buildPreviewCapacityCaps } from "./section-aware-rotation";

const ROOT = join(__dirname, "../..");
function readRepo(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const DEPT = "flooring-dept";

function sectionEntry(
  section_id: string,
  section_name: string,
  steward: string,
  department_id: string,
  aisle: string,
  bay: number
): [string, BaySectionLookup] {
  const lookup: BaySectionLookup = {
    section_id,
    section_name,
    primary_owner_specialist_id: steward,
    primary_owner_name: steward,
    department_id,
    is_active: true,
  };
  return [sectionAwarePhysicalKey({ department_id, aisle, bay }), lookup];
}

type BaySeed = {
  aisle: string;
  bay: number;
  steward: string;
  section_id: string;
  section_name: string;
};

function baySeeds(): BaySeed[] {
  const seeds: BaySeed[] = [];
  for (const aisle of ["39", "40", "7"]) {
    for (let bay = 1; bay <= 6; bay += 1) {
      seeds.push({
        aisle,
        bay,
        steward: "nate",
        section_id: "csa",
        section_name: "Nate Section",
      });
    }
  }
  for (const aisle of ["5", "6"]) {
    for (let bay = 1; bay <= 6; bay += 1) {
      seeds.push({
        aisle,
        bay,
        steward: "tyson",
        section_id: "myself",
        section_name: "Tyson Section",
      });
    }
  }
  for (const aisle of ["43", "44"]) {
    for (let bay = 1; bay <= 6; bay += 1) {
      seeds.push({
        aisle,
        bay,
        steward: "nick",
        section_id: "sa",
        section_name: "Nick Section",
      });
    }
  }
  for (const aisle of ["41", "42"]) {
    for (let bay = 1; bay <= 6; bay += 1) {
      seeds.push({
        aisle,
        bay,
        steward: "tracy",
        section_id: "sb",
        section_name: "Tracy Section",
      });
    }
  }
  return seeds;
}

function buildSections(): Map<string, BaySectionLookup> {
  return new Map(
    baySeeds().map((s) =>
      sectionEntry(
        s.section_id,
        s.section_name,
        s.steward,
        DEPT,
        s.aisle,
        s.bay
      )
    )
  );
}

function allAgingCandidates() {
  return baySeeds().map((s) => ({
    department_id: DEPT,
    aisle: s.aisle,
    bay: s.bay,
    rotationId: `rot-${s.aisle}-${s.bay}`,
  }));
}

const members = [
  { specialist_id: "tyson", specialist_name: "Tyson", active: true, hours: 53 },
  { specialist_id: "nick", specialist_name: "Nick", active: true, hours: 45 },
  { specialist_id: "tracy", specialist_name: "Tracy", active: true, hours: 43 },
  { specialist_id: "nate", specialist_name: "Nate", active: true, hours: 22 },
];

const ownedAisles: Record<string, string[]> = {
  tyson: ["5", "6"],
  nate: ["39", "40", "7"],
  nick: ["43", "44"],
  tracy: ["41", "42"],
};

function fullProposal() {
  const sections = buildSections();
  const bays = allAgingCandidates().map((c) => ({
    ...c,
    riskScore: 0,
    priority_tier: "aging" as const,
  }));
  const capacity = buildPreviewCapacityCaps({
    eligibleSpecialistIds: ["tyson", "nick", "tracy", "nate"],
    ownedBySpecialist: {},
    ownedTotal: 0,
    approvedBySpecialist: { tyson: 3, nick: 3, tracy: 3, nate: 2 },
  });
  return composeStewardshipWeeklyProposal({
    store_number: "2587",
    week_label: "2026-W42",
    tiers: classifyBayPriorityTier(bays),
    bays,
    members,
    baySectionByKey: sections,
    capacity,
  });
}

describe("OPERATIONAL-011 strict section ownership", () => {
  it("Tyson receives only owned bays (aisles 5, 6)", () => {
    const proposal = fullProposal();
    const mine = proposal.items.filter((i) => i.specialist_id === "tyson");
    expect(mine.length).toBeGreaterThan(0);
    expect(
      mine.every((i) => ownedAisles.tyson.includes(String(i.aisle)))
    ).toBe(true);
  });

  it("Nate receives only owned bays (aisles 39, 40, 7)", () => {
    const proposal = fullProposal();
    const mine = proposal.items.filter((i) => i.specialist_id === "nate");
    expect(mine.length).toBeGreaterThan(0);
    expect(
      mine.every((i) => ownedAisles.nate.includes(String(i.aisle)))
    ).toBe(true);
  });

  it("Nick receives only owned bays (aisles 43, 44)", () => {
    const proposal = fullProposal();
    const mine = proposal.items.filter((i) => i.specialist_id === "nick");
    expect(mine.length).toBeGreaterThan(0);
    expect(
      mine.every((i) => ownedAisles.nick.includes(String(i.aisle)))
    ).toBe(true);
  });

  it("Tracy receives only owned bays (aisles 41, 42)", () => {
    const proposal = fullProposal();
    const mine = proposal.items.filter((i) => i.specialist_id === "tracy");
    expect(mine.length).toBeGreaterThan(0);
    expect(
      mine.every((i) => ownedAisles.tracy.includes(String(i.aisle)))
    ).toBe(true);
  });

  it("cross-section assignment is rejected (no fill from other sections)", () => {
    const sections = buildSections();
    const tysonOnly = allAgingCandidates()
      .filter((c) => ["5", "6"].includes(String(c.aisle)))
      .map((c) => ({
        ...c,
        riskScore: 0,
        priority_tier: "aging" as const,
      }));
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["nate"],
      ownedBySpecialist: {},
      ownedTotal: 0,
      approvedBySpecialist: { nate: 2 },
    });
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: classifyBayPriorityTier(tysonOnly),
      bays: tysonOnly,
      members: [members[3]!],
      baySectionByKey: sections,
      capacity,
    });
    expect(proposal.actionable).toBe(true);
    expect(proposal.items).toHaveLength(0);
    expect(proposal.unfilled_capacity.some((u) => u.specialist_id === "nate")).toBe(
      true
    );
  });

  it("approved capacity is respected", () => {
    const proposal = fullProposal();
    const counts: Record<string, number> = {};
    for (const item of proposal.items) {
      counts[item.specialist_id] = (counts[item.specialist_id] ?? 0) + 1;
    }
    expect(counts.nate).toBeLessThanOrEqual(2);
    expect(counts.tyson).toBeLessThanOrEqual(3);
    expect(counts.nick).toBeLessThanOrEqual(3);
    expect(counts.tracy).toBeLessThanOrEqual(3);
    expect(proposal.items).toHaveLength(11);
  });

  it("priority ordering is preserved within owned section", () => {
    const sections = buildSections();
    const carry = {
      department_id: DEPT,
      aisle: "5",
      bay: 99,
      rotationId: "carry-1",
      riskScore: 0,
      priority_tier: "carry" as const,
      carried_over: true,
    };
    sections.set(sectionAwarePhysicalKey(carry), {
      section_id: "myself",
      section_name: "Tyson Section",
      primary_owner_specialist_id: "tyson",
      primary_owner_name: "Tyson",
      department_id: DEPT,
      is_active: true,
    });
    const aging = allAgingCandidates()
      .filter((c) => c.aisle === "5")
      .slice(0, 3)
      .map((c) => ({
        ...c,
        riskScore: 0,
        priority_tier: "aging" as const,
      }));
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["tyson"],
      ownedBySpecialist: {},
      ownedTotal: 0,
      approvedBySpecialist: { tyson: 1 },
    });
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: classifyBayPriorityTier([carry, ...aging]),
      bays: [carry, ...aging],
      members: [members[0]!],
      baySectionByKey: sections,
      capacity,
    });
    expect(proposal.items[0]?.rotationId).toBe("carry-1");
    expect(proposal.items[0]?.explanation.priority_tier).toBe("carry");
  });

  it("aisle diversity works within sections", () => {
    const sections = buildSections();
    const { selected } = selectBaysWithStrictSectionOwnership(
      [{ tier: "aging", candidates: allAgingCandidates() }],
      { tyson: 3, nick: 3, tracy: 3, nate: 2 },
      sections
    );
    const tysonAisles = new Set(
      selected
        .filter((b) => b.owner_specialist_id === "tyson")
        .map((b) => String(b.aisle))
    );
    expect(tysonAisles.size).toBeGreaterThan(1);
  });

  it("insufficient eligible bays leave capacity unfilled", () => {
    const sections = buildSections();
    const oneBay = [
      {
        department_id: DEPT,
        aisle: "5",
        bay: 1,
        rotationId: "rot-5-1",
        riskScore: 0,
        priority_tier: "aging" as const,
      },
    ];
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["tyson"],
      ownedBySpecialist: {},
      ownedTotal: 0,
      approvedBySpecialist: { tyson: 3 },
    });
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: classifyBayPriorityTier(oneBay),
      bays: oneBay,
      members: [members[0]!],
      baySectionByKey: sections,
      capacity,
    });
    expect(proposal.items).toHaveLength(1);
    const unfilled = proposal.unfilled_capacity.find(
      (u) => u.specialist_id === "tyson"
    );
    expect(unfilled?.unfilled).toBe(2);
    expect(unfilled?.code).toBe("insufficient_eligible_bays");
  });

  it("missing ownership fails closed", () => {
    const empty = new Map<string, BaySectionLookup>();
    const evidence = inspectSectionOwnershipEvidence(empty, {
      requireMembershipEvidence: true,
    });
    expect(evidence.ok).toBe(false);
    if (!evidence.ok) expect(evidence.issue.code).toBe("OWNERSHIP_MISSING");

    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["tyson"],
      ownedBySpecialist: {},
      ownedTotal: 0,
      approvedBySpecialist: { tyson: 3 },
    });
    const bays = allAgingCandidates()
      .filter((c) => c.aisle === "5")
      .slice(0, 3)
      .map((c) => ({ ...c, riskScore: 0, priority_tier: "aging" as const }));
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: classifyBayPriorityTier(bays),
      bays,
      members: [members[0]!],
      baySectionByKey: empty,
      capacity,
    });
    expect(proposal.actionable).toBe(false);
    expect(proposal.items).toHaveLength(0);
  });

  it("overlapping ownership fails closed", () => {
    const key = sectionAwarePhysicalKey({
      department_id: DEPT,
      aisle: "5",
      bay: 1,
    });
    const conflicts = findActiveBayMembershipConflicts([
      {
        section_id: "a",
        section_is_active: true,
        department_id: DEPT,
        aisle: "5",
        bay: 1,
      },
      {
        section_id: "b",
        section_is_active: true,
        department_id: DEPT,
        aisle: "5",
        bay: 1,
      },
    ]);
    expect(conflicts).toContain(key);

    const overlap = inspectSectionOwnershipEvidence(buildSections(), {
      conflictPhysicalKeys: conflicts,
    });
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.issue.code).toBe("OWNERSHIP_OVERLAP");

    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["tyson", "nate"],
      ownedBySpecialist: {},
      ownedTotal: 0,
      approvedBySpecialist: { tyson: 1, nate: 1 },
    });
    const bays = allAgingCandidates()
      .slice(0, 4)
      .map((c) => ({ ...c, riskScore: 0, priority_tier: "aging" as const }));
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: classifyBayPriorityTier(bays),
      bays,
      members: members.filter(
        (m) => m.specialist_id === "tyson" || m.specialist_id === "nate"
      ),
      baySectionByKey: buildSections(),
      conflictPhysicalKeys: conflicts,
      capacity,
    });
    expect(proposal.actionable).toBe(false);
    expect(proposal.items).toHaveLength(0);

    const wrong = assertAssigneeOwnsBay(
      { department_id: DEPT, aisle: "5", bay: 1 },
      "nate",
      buildSections()
    );
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe("SECTION_OWNERSHIP_MISMATCH");
  });

  it("ownership changes invalidate stale plans", () => {
    const proposal = fullProposal();
    expect(proposal.actionable).toBe(true);
    const sections = buildSections();
    // Transfer aisle 5 bay 1 from Tyson to Nate
    const key = sectionAwarePhysicalKey({
      department_id: DEPT,
      aisle: "5",
      bay: 1,
    });
    sections.set(key, {
      section_id: "csa",
      section_name: "Nate Section",
      primary_owner_specialist_id: "nate",
      primary_owner_name: "Nate",
      department_id: DEPT,
      is_active: true,
    });
    const bays = allAgingCandidates().map((c) => ({
      ...c,
      riskScore: 0,
      priority_tier: "aging" as const,
    }));
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["tyson", "nick", "tracy", "nate"],
      ownedBySpecialist: {},
      ownedTotal: 0,
      approvedBySpecialist: { tyson: 3, nick: 3, tracy: 3, nate: 2 },
    });
    const recomputed = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: classifyBayPriorityTier(bays),
      bays,
      members,
      baySectionByKey: sections,
      capacity,
    });
    expect(recomputed.ownership_digest).not.toBe(proposal.ownership_digest);
    const freshness = assertStewardshipProposalFresh(
      proposal.fingerprint,
      recomputed
    );
    expect(freshness.ok).toBe(false);
  });

  it("legacy paths cannot bypass enforcement (RPC + assign contracts)", () => {
    const sql = readRepo(
      "supabase/migrations/20261018_operational_011_section_ownership.sql"
    );
    expect(sql).toMatch(/SECTION_OWNERSHIP_MISMATCH/);
    expect(sql).toMatch(/SECTION_OWNERSHIP_MISSING/);
    expect(sql).toMatch(/SECTION_OWNERSHIP_AMBIGUOUS/);
    expect(sql).toMatch(/section_ownership_enforced/);
    expect(sql).toMatch(/operational_section_members/);

    const modal = readRepo("components/admin/SundayAuditAssignmentModal.tsx");
    expect(modal).toMatch(/composeStewardshipWeeklyProposal/);
    expect(modal).not.toMatch(
      /handleBalanceAssign[\s\S]{0,800}buildScheduleBalancePlan/
    );

    const capacity = readRepo("lib/store-ops/shared-week-capacity.ts");
    expect(capacity).toMatch(/SECTION_OWNERSHIP_MISMATCH/);
    expect(capacity).toMatch(/writeSundayAssignmentsWithCapacity/);
  });

  it("historical assignments remain intact (no rewrite SQL)", () => {
    const sql = readRepo(
      "supabase/migrations/20261018_operational_011_section_ownership.sql"
    );
    expect(sql).not.toMatch(/delete from public\.sunday_bay_assignments/i);
    expect(sql).not.toMatch(/update public\.sunday_bay_assignments/i);
    expect(sql).not.toMatch(/operational_section_members[\s\S]*delete/i);
    expect(sql).not.toMatch(/week.?41/i);
  });

  it("Zebra evidence remains independent", () => {
    const enforce = readRepo("lib/store-ops/section-ownership-enforcement.ts");
    expect(enforce).not.toMatch(/zebra/i);
    const sql = readRepo(
      "supabase/migrations/20261018_operational_011_section_ownership.sql"
    );
    expect(sql).not.toMatch(/zebra/i);
  });

  it("Sunday auto-stage remains OFF", () => {
    expect(SECTION_AWARE_ROTATION_AUTO_STAGE).toBe(false);
    expect(STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE).toBe(false);
    expect(STRICT_SECTION_OWNERSHIP_AUTO_STAGE).toBe(false);
  });

  it("associateOwnsBay and digest are deterministic", () => {
    const sections = buildSections();
    expect(
      associateOwnsBay(
        { department_id: DEPT, aisle: "5", bay: 1 },
        "tyson",
        sections
      )
    ).toBe(true);
    expect(
      associateOwnsBay(
        { department_id: DEPT, aisle: "5", bay: 1 },
        "nate",
        sections
      )
    ).toBe(false);
    const a = buildSectionOwnershipDigest(sections);
    const b = buildSectionOwnershipDigest(sections);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });
});
