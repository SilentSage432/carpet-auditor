/**
 * DEPTSYNC-SECTION-ROTATION-006 — stewardship distribution tests.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { BaySectionLookup } from "./operational-sections";
import {
  SECTION_AWARE_ROTATION_AUTO_STAGE,
  sectionAwarePhysicalKey,
} from "./section-aware-rotation";
import {
  STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE,
  assertStewardshipProposalFresh,
  classifyBayPriorityTier,
  composeStewardshipWeeklyProposal,
  selectBaysWithStewardshipDistribution,
} from "./stewardship-week-distribution";
import { buildPreviewCapacityCaps } from "./section-aware-rotation";

const ROOT = join(__dirname, "../..");
function readRepo(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

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

const DEPT = "flooring-dept";

type BaySeed = { aisle: string; bay: number; steward: string; section_id: string; section_name: string };

function baySeeds(): BaySeed[] {
  const seeds: BaySeed[] = [];
  for (const aisle of ["39", "40", "7"]) {
    for (let bay = 1; bay <= 6; bay += 1) {
      seeds.push({ aisle, bay, steward: "nate", section_id: "csa", section_name: "CSA" });
    }
  }
  for (const aisle of ["5", "6"]) {
    for (let bay = 1; bay <= 6; bay += 1) {
      seeds.push({
        aisle,
        bay,
        steward: "tyson",
        section_id: "myself",
        section_name: "Myself",
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
        section_name: "Specialist-A",
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
        section_name: "Specialist-B",
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

describe("SECTION-ROTATION-006 capacity + distribution", () => {
  it("1. Week 42 shared capacity = 11", () => {
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["tyson", "nick", "tracy", "nate"],
      ownedBySpecialist: {},
      ownedTotal: 0,
      approvedBySpecialist: { tyson: 3, nick: 3, tracy: 3, nate: 2 },
    });
    expect(capacity.shared_target).toBe(11);
    expect(capacity.approvals_complete).toBe(true);
  });

  it("2–3. Nate ≤2; Tyson/Nick/Tracy ≤3", () => {
    const sections = buildSections();
    const candidates = allAgingCandidates();
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["tyson", "nick", "tracy", "nate"],
      ownedBySpecialist: {},
      ownedTotal: 0,
      approvedBySpecialist: { tyson: 3, nick: 3, tracy: 3, nate: 2 },
    });
    const bays = candidates.map((c) => ({
      ...c,
      riskScore: 0,
      priority_tier: "aging" as const,
    }));
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: classifyBayPriorityTier(bays),
      bays,
      members,
      baySectionByKey: sections,
      capacity,
    });
    expect(proposal.actionable).toBe(true);
    expect(proposal.items).toHaveLength(11);
    const counts: Record<string, number> = {};
    for (const item of proposal.items) {
      counts[item.specialist_id] = (counts[item.specialist_id] ?? 0) + 1;
    }
    expect(counts.nate).toBeLessThanOrEqual(2);
    expect(counts.tyson).toBeLessThanOrEqual(3);
    expect(counts.nick).toBeLessThanOrEqual(3);
    expect(counts.tracy).toBeLessThanOrEqual(3);
  });

  it("4. existing assignments reduce remaining capacity", () => {
    const sections = buildSections();
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["nate"],
      ownedBySpecialist: { nate: 1 },
      ownedTotal: 1,
      approvedBySpecialist: { nate: 2 },
    });
    expect(capacity.remaining_by_specialist.nate).toBe(1);
    const bays = allAgingCandidates()
      .filter((c) => ["39", "40", "7"].includes(String(c.aisle)))
      .map((c) => ({ ...c, riskScore: 0, priority_tier: "aging" as const }));
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: classifyBayPriorityTier(bays),
      bays,
      members: [members[3]!],
      baySectionByKey: sections,
      ownedRotationIds: ["rot-39-1"],
      capacity,
    });
    expect(proposal.items.length).toBeLessThanOrEqual(1);
  });

  it("5. missing approval blocks actionable proposal", () => {
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: [{ tier: "aging", candidates: allAgingCandidates() }],
      bays: [],
      members,
      baySectionByKey: buildSections(),
      capacity: {
        shared_target: 0,
        owned_total: 0,
        remaining_shared: 0,
        remaining_by_specialist: {},
        eligible_specialist_ids: ["nate"],
        approvals_complete: false,
        approved_by_specialist: {},
      },
    });
    expect(proposal.actionable).toBe(false);
    expect(proposal.items).toHaveLength(0);
  });

  it("6. stale approval (incomplete) blocks actionable proposal", () => {
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: [{ tier: "aging", candidates: allAgingCandidates() }],
      bays: [],
      members,
      baySectionByKey: buildSections(),
      capacity: {
        shared_target: 3,
        owned_total: 0,
        remaining_shared: 3,
        remaining_by_specialist: { nate: 0, tyson: 3 },
        eligible_specialist_ids: ["nate", "tyson"],
        approvals_complete: false,
        approved_by_specialist: { tyson: 3 },
      },
    });
    expect(proposal.actionable).toBe(false);
  });

  it("7. zero capacity produces zero assignments", () => {
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["nate"],
      ownedBySpecialist: {},
      ownedTotal: 0,
      approvedBySpecialist: { nate: 0 },
    });
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: [{ tier: "aging", candidates: allAgingCandidates() }],
      bays: allAgingCandidates().map((c) => ({
        ...c,
        riskScore: 0,
        priority_tier: "aging" as const,
      })),
      members: [members[3]!],
      baySectionByKey: buildSections(),
      capacity,
    });
    expect(proposal.items).toHaveLength(0);
  });

  it("8. no duplicate bay proposals", () => {
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
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: classifyBayPriorityTier(bays),
      bays,
      members,
      baySectionByKey: sections,
      capacity,
    });
    const keys = proposal.items.map((i) => i.physical_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("9. priority ordering preserved (carry before aging)", () => {
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
    const aging = allAgingCandidates()
      .filter((c) => c.aisle === "39")
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
    // Ensure carry bay is sectioned to Tyson
    sections.set(sectionAwarePhysicalKey(carry), {
      section_id: "myself",
      section_name: "Myself",
      primary_owner_specialist_id: "tyson",
      primary_owner_name: "Tyson",
      department_id: DEPT,
      is_active: true,
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

  it("10. equivalent-priority candidates distribute across aisles", () => {
    const sections = buildSections();
    const remaining = {
      tyson: 3,
      nick: 3,
      tracy: 3,
      nate: 2,
    };
    const selected = selectBaysWithStewardshipDistribution(
      [{ tier: "aging", candidates: allAgingCandidates() }],
      11,
      sections,
      remaining
    );
    const aisles = new Set(selected.map((b) => String(b.aisle)));
    expect(aisles.size).toBeGreaterThan(1);
  });

  it("11. stewarded candidates preferred where appropriate", () => {
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
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: classifyBayPriorityTier(bays),
      bays,
      members,
      baySectionByKey: sections,
      capacity,
    });
    expect(proposal.steward_match_count).toBeGreaterThan(0);
    const nateItems = proposal.items.filter((i) => i.specialist_id === "nate");
    expect(
      nateItems.every((i) => ["39", "40", "7"].includes(String(i.aisle)))
    ).toBe(true);
  });

  it("12. outside-section selection is refused (OPERATIONAL-011)", () => {
    // Only Nate has capacity, but only Tyson section bays exist → unfilled.
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
    expect(proposal.items).toHaveLength(0);
    expect(
      proposal.unfilled_capacity.some((u) => u.specialist_id === "nate")
    ).toBe(true);
  });

  it("13–14. unavailable associate keeps section; no cross-section fill", () => {
    // Nick has 0 capacity — his section remains in map; others do not absorb
    // Nick's bays to fill unused capacity.
    const sections = buildSections();
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["tyson", "tracy", "nate"],
      ownedBySpecialist: {},
      ownedTotal: 0,
      approvedBySpecialist: { tyson: 3, tracy: 3, nate: 2 },
    });
    const bays = allAgingCandidates().map((c) => ({
      ...c,
      riskScore: 0,
      priority_tier: "aging" as const,
    }));
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: classifyBayPriorityTier(bays),
      bays,
      members: members.filter((m) => m.specialist_id !== "nick"),
      baySectionByKey: sections,
      capacity,
    });
    expect(proposal.items.some((i) => i.specialist_id === "nick")).toBe(false);
    expect(
      proposal.items.every((i) => String(i.aisle) !== "43" && String(i.aisle) !== "44")
    ).toBe(true);
    expect(sections.size).toBeGreaterThan(0);
    expect(proposal.items).toHaveLength(8);
  });

  it("15. named zero-bay locations are not fabricated", () => {
    const src = readRepo("lib/store-ops/stewardship-week-distribution.ts");
    expect(src).toMatch(/Zero-bay named locations are not invented/);
    expect(src).not.toMatch(/SHOW-L|CARPET-WALL/);
  });

  it("16. selection is deterministic for identical inputs", () => {
    const sections = buildSections();
    const remaining = { tyson: 3, nick: 3, tracy: 3, nate: 2 };
    const a = selectBaysWithStewardshipDistribution(
      [{ tier: "aging", candidates: allAgingCandidates() }],
      11,
      sections,
      remaining
    );
    const b = selectBaysWithStewardshipDistribution(
      [{ tier: "aging", candidates: allAgingCandidates() }],
      11,
      sections,
      remaining
    );
    expect(a.map((x) => sectionAwarePhysicalKey(x))).toEqual(
      b.map((x) => sectionAwarePhysicalKey(x))
    );
  });

  it("17. stale proposals cannot be silently confirmed", () => {
    const fresh = assertStewardshipProposalFresh("abc", {
      fingerprint: "abc",
      actionable: true,
    } as never);
    expect(fresh.ok).toBe(true);
    const stale = assertStewardshipProposalFresh("abc", {
      fingerprint: "xyz",
      actionable: true,
    } as never);
    expect(stale.ok).toBe(false);
    const blocked = assertStewardshipProposalFresh("abc", {
      fingerprint: "abc",
      actionable: false,
    } as never);
    expect(blocked.ok).toBe(false);
  });

  it("18–19. safeguards + auto-stage OFF", () => {
    expect(SECTION_AWARE_ROTATION_AUTO_STAGE).toBe(false);
    expect(STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE).toBe(false);
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(dispatch).toMatch(/assertApprovedCapacityReady/);
    expect(dispatch).not.toMatch(/STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE\s*=\s*true/);
  });

  it("20. empty sections fail closed (no unrestricted assignment)", () => {
    const empty = new Map<string, BaySectionLookup>();
    const candidates = [
      { department_id: DEPT, aisle: "5", bay: 1, rotationId: "r1" },
      { department_id: DEPT, aisle: "41", bay: 2, rotationId: "r2" },
    ];
    const selected = selectBaysWithStewardshipDistribution(
      [{ tier: "aging", candidates }],
      2,
      empty,
      { tyson: 2 }
    );
    expect(selected).toHaveLength(0);
  });

  it("explanations are deterministic evidence strings (no LLM)", () => {
    const sections = buildSections();
    const bays = allAgingCandidates().map((c) => ({
      ...c,
      riskScore: 0,
      priority_tier: "aging" as const,
    }));
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: ["tyson", "nate"],
      ownedBySpecialist: {},
      ownedTotal: 0,
      approvedBySpecialist: { tyson: 1, nate: 1 },
    });
    const proposal = composeStewardshipWeeklyProposal({
      store_number: "2587",
      week_label: "2026-W42",
      tiers: classifyBayPriorityTier(bays),
      bays,
      members: members.filter((m) => m.specialist_id === "tyson" || m.specialist_id === "nate"),
      baySectionByKey: sections,
      capacity,
    });
    for (const item of proposal.items) {
      expect(item.explanation.summary.length).toBeGreaterThan(10);
      expect(item.explanation.codes.length).toBeGreaterThan(0);
      expect(item.explanation.summary).not.toMatch(/gemini|openai|llm/i);
    }
  });
});
