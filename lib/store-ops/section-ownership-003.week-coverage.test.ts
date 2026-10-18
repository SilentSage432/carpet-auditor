/**
 * DEPTSYNC-SECTION-OWNERSHIP-003 — temporary weekly section coverage.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEEKLY_ROTATION_AUTO_PUBLISH } from "./authoritative-week-cycle";
import { selectSectionBalancedPhysicalBayCoverage } from "./section-balanced-stage";
import { planDeactivateDecision } from "./roster-lifecycle";
import {
  applyWeekCoverageToBaySectionLookups,
  classifyPublishedWeekCoverageRisk,
  isValidCoverageWeekLabel,
  previewCoverageCapacityImpact,
} from "./section-week-coverage";
import type { BaySectionLookup } from "./operational-sections";
import type { StoreLocation } from "./types";

function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const DEPT = "dept-floor";

function lookup(
  section_id: string,
  owner: string,
  name = section_id
): BaySectionLookup {
  return {
    section_id,
    section_name: name,
    primary_owner_specialist_id: owner,
    primary_owner_name: owner,
    department_id: DEPT,
    is_active: true,
  };
}

function bayKey(aisle: string, bay: number): string {
  return `${DEPT}|${aisle}|${bay}`;
}

function loc(
  aisle: string,
  bay: number,
  id = `${aisle}-${bay}`,
  completedAt = "2026-09-01T12:00:00.000Z"
): StoreLocation {
  return {
    id,
    store_id: "store-1",
    store_number: "2587",
    department_id: DEPT,
    aisle,
    bay,
    type: "SELLING",
    location_type: "STANDARD",
    is_active: true,
    status: "PENDING",
    // Unique ages avoid equal-weight Math.random ties in physical-bay draw.
    last_completed_at: completedAt,
  } as StoreLocation;
}

describe("SECTION-OWNERSHIP-003 week label + capacity preview", () => {
  it("validates ISO week labels", () => {
    expect(isValidCoverageWeekLabel("2026-W45")).toBe(true);
    expect(isValidCoverageWeekLabel("2026-W4")).toBe(false);
    expect(isValidCoverageWeekLabel("")).toBe(false);
  });

  it("capacity preview does not multiply budget across sections", () => {
    const impact = previewCoverageCapacityImpact({
      covering_specialist_id: "tracy",
      covering_specialist_name: "Tracy",
      approved_capacity: 3,
      permanent_section_ids: ["sec-d"],
      covered_section_ids: ["sec-b"],
    });
    expect(impact.approved_capacity).toBe(3);
    expect(impact.section_pool_count).toBe(2);
    expect(impact.note).toMatch(/does not multiply capacity/i);
  });
});

describe("SECTION-OWNERSHIP-003 permanent ownership preservation", () => {
  it("overlay swaps effective owner without mutating source map", () => {
    const permanent = new Map<string, BaySectionLookup>([
      [bayKey("39", 1), lookup("sec-b", "nate", "Section B")],
      [bayKey("41", 1), lookup("sec-d", "tracy", "Section D")],
    ]);
    const covered = applyWeekCoverageToBaySectionLookups(
      permanent,
      new Map([["sec-b", "tracy"]])
    );
    expect(permanent.get(bayKey("39", 1))?.primary_owner_specialist_id).toBe(
      "nate"
    );
    expect(covered.get(bayKey("39", 1))?.primary_owner_specialist_id).toBe(
      "tracy"
    );
    expect(covered.get(bayKey("41", 1))?.primary_owner_specialist_id).toBe(
      "tracy"
    );
  });

  it("week without coverage leaves permanent owners", () => {
    const permanent = new Map([[bayKey("39", 1), lookup("sec-b", "nate")]]);
    const covered = applyWeekCoverageToBaySectionLookups(permanent, new Map());
    expect(covered.get(bayKey("39", 1))?.primary_owner_specialist_id).toBe(
      "nate"
    );
  });
});

describe("SECTION-OWNERSHIP-003 multi-section capacity (deterministic)", () => {
  it("Tracy covering B+D draws at most 3 total from union pool", () => {
    const baySectionByKey = applyWeekCoverageToBaySectionLookups(
      new Map([
        [bayKey("39", 1), lookup("sec-b", "nate")],
        [bayKey("39", 2), lookup("sec-b", "nate")],
        [bayKey("39", 3), lookup("sec-b", "nate")],
        [bayKey("41", 1), lookup("sec-d", "tracy")],
        [bayKey("41", 2), lookup("sec-d", "tracy")],
        [bayKey("41", 3), lookup("sec-d", "tracy")],
      ]),
      new Map([["sec-b", "tracy"]])
    );

    const pending = [
      loc("39", 1, "39-1", "2026-08-01T12:00:00.000Z"),
      loc("39", 2, "39-2", "2026-08-08T12:00:00.000Z"),
      loc("39", 3, "39-3", "2026-08-15T12:00:00.000Z"),
      loc("41", 1, "41-1", "2026-08-22T12:00:00.000Z"),
      loc("41", 2, "41-2", "2026-08-29T12:00:00.000Z"),
      loc("41", 3, "41-3", "2026-09-05T12:00:00.000Z"),
    ];

    // Capacity + ownership contracts are deterministic (cap 3, Tracy-only pool).
    // Exact bay keys may vary under equal-weight physical-bay draws (existing engine).
    for (let i = 0; i < 5; i += 1) {
      const result = selectSectionBalancedPhysicalBayCoverage({
        pending,
        carried: [],
        slots: [
          { specialist_id: "tracy", specialist_name: "Tracy", capacity: 3 },
        ],
        baySectionByKey,
      });
      expect(result.selected).toHaveLength(3);
      expect(new Set(result.selected.map((r) => r.key)).size).toBe(3);
      for (const row of result.selected) {
        expect(baySectionByKey.get(row.key)?.primary_owner_specialist_id).toBe(
          "tracy"
        );
      }
      expect(result.shortfalls.filter((s) => s.unfilled > 0)).toHaveLength(0);
    }
  });

  it("insufficient eligible bays surfaces shortfall", () => {
    const baySectionByKey = new Map([
      [bayKey("39", 1), lookup("sec-b", "nate")],
    ]);
    const result = selectSectionBalancedPhysicalBayCoverage({
      pending: [loc("39", 1)],
      carried: [],
      slots: [{ specialist_id: "nate", specialist_name: "Nate", capacity: 3 }],
      baySectionByKey,
    });
    expect(result.selected).toHaveLength(1);
    expect(
      result.shortfalls.some((s) => s.code === "insufficient_eligible_bays")
    ).toBe(true);
  });
});

describe("SECTION-OWNERSHIP-003 published-week protection", () => {
  it("requires ack when week has protected or conflicting rows", () => {
    const risk = classifyPublishedWeekCoverageRisk({
      existing_assignments: [
        {
          roster_specialist_id: "nate",
          status: "completed",
          supervisor_locked: false,
        },
        {
          roster_specialist_id: "nate",
          status: "assigned",
          supervisor_locked: true,
        },
        {
          roster_specialist_id: "nate",
          status: "assigned",
          supervisor_locked: false,
        },
      ],
      previous_effective_owner_id: "nate",
      next_covering_specialist_id: "tracy",
    });
    expect(risk.has_published_assignments).toBe(true);
    expect(risk.requires_explicit_ack).toBe(true);
    expect(risk.protected_count).toBe(2);
    expect(risk.conflicting_open_count).toBe(1);
  });

  it("empty week does not require ack", () => {
    const risk = classifyPublishedWeekCoverageRisk({
      existing_assignments: [],
      previous_effective_owner_id: "nate",
      next_covering_specialist_id: "tracy",
    });
    expect(risk.requires_explicit_ack).toBe(false);
  });
});

describe("SECTION-OWNERSHIP-003 roster lifecycle compatibility", () => {
  it("warns on future temporary coverage during deactivate", () => {
    const result = planDeactivateDecision({
      role: "Associate",
      owned_sections: [],
      transfers: [],
      open_assignment_count: 0,
      standing_capacity: null,
      future_coverage_count: 2,
    });
    expect(result.can_deactivate).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/temporary coverage/i);
  });
});

describe("SECTION-OWNERSHIP-003 source contracts", () => {
  it("migration adds coverage table and effective-owner RPC resolution", () => {
    const sql = readRepo(
      "supabase/migrations/20261026_section_ownership_003_week_coverage.sql"
    );
    expect(sql).toMatch(/operational_section_week_coverage/);
    expect(sql).toMatch(/effective_operational_section_owner/);
    expect(sql).toMatch(/SECTION-OWNERSHIP-003: week-effective owner/);
    expect(sql).not.toMatch(/primary_owner_specialist_id\s*=/);
  });

  it("planner loads coverage before section-balanced stage", () => {
    const src = readRepo("lib/store-ops/authoritative-week-cycle.ts");
    expect(src).toMatch(/loadCoverageOwnerBySectionId/);
    expect(src).toMatch(/applyWeekCoverageToBaySectionLookups/);
  });

  it("API gates establish/revoke to supervisor and rejects inactive cover", () => {
    const route = readRepo("app/api/section-week-coverage/route.ts");
    const domain = readRepo("lib/store-ops/section-week-coverage.ts");
    expect(route).toMatch(/requireSupervisorOrAdmin/);
    expect(route).toMatch(/acknowledge_published_week/);
    expect(domain).toMatch(/inactive_cover/);
    expect(domain).toMatch(/MasterAdmin cannot be assigned/);
  });

  it("Operational Sections UI exposes coverage controls", () => {
    const ui = readRepo("components/admin/OperationalSectionsPanel.tsx");
    expect(ui).toMatch(/sections-week-coverage/);
    expect(ui).toMatch(/sections-coverage-save/);
    expect(ui).toMatch(/sections-coverage-revoke/);
    expect(ui).not.toMatch(/shift calendar|Shift entry/i);
  });

  it("does not disable AUTO-008 latch or cron", () => {
    expect(WEEKLY_ROTATION_AUTO_PUBLISH).toBe(true);
    const vercel = readRepo("vercel.json");
    expect(vercel).toMatch(/"0 12 \* \* 0"/);
    const domain = readRepo("lib/store-ops/section-week-coverage.ts");
    expect(domain).not.toMatch(/WEEKLY_ROTATION_AUTO_PUBLISH\s*=/);
    expect(domain).not.toMatch(/DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH/);
  });

  it("does not introduce a parallel publisher", () => {
    const domain = readRepo("lib/store-ops/section-week-coverage.ts");
    expect(domain).not.toMatch(/upsert_sunday_bay_assignments/);
    const cycle = readRepo("lib/store-ops/authoritative-week-cycle.ts");
    expect(cycle).toMatch(/composeAuthoritativeAssignmentProposal|loadAuthoritativeStageContext/);
  });
});
