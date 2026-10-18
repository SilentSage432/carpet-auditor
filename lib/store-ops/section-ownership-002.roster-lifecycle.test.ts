/**
 * DEPTSYNC-SECTION-OWNERSHIP-002 — roster lifecycle contracts.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEEKLY_ROTATION_AUTO_PUBLISH } from "./authoritative-week-cycle";
import { planDeactivateDecision } from "./roster-lifecycle";

function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("SECTION-OWNERSHIP-002 deactivate planner", () => {
  it("blocks MasterAdmin deactivation", () => {
    const result = planDeactivateDecision({
      role: "MasterAdmin",
      owned_sections: [],
      transfers: [],
      open_assignment_count: 0,
      standing_capacity: null,
    });
    expect(result.can_deactivate).toBe(false);
    expect(result.block_reasons.join(" ")).toMatch(/MasterAdmin/i);
  });

  it("blocks when permanent section owner has no transfer", () => {
    const result = planDeactivateDecision({
      role: "Associate",
      owned_sections: [
        {
          section_id: "sec-b",
          section_name: "CSA",
          department_id: "dept",
        },
      ],
      transfers: [],
      open_assignment_count: 2,
      standing_capacity: {
        policy_id: "pol",
        policy_version: 1,
        approved_capacity: 3,
      },
    });
    expect(result.can_deactivate).toBe(false);
    expect(result.missing_section_ids).toEqual(["sec-b"]);
    expect(result.warnings.join(" ")).toMatch(/open assignment/i);
    expect(result.warnings.join(" ")).toMatch(/Standing capacity/i);
  });

  it("allows deactivate when ownership is transferred", () => {
    const result = planDeactivateDecision({
      role: "Associate",
      owned_sections: [
        {
          section_id: "sec-b",
          section_name: "CSA",
          department_id: "dept",
        },
      ],
      transfers: [
        { section_id: "sec-b", new_owner_specialist_id: "tracy" },
      ],
      open_assignment_count: 1,
      standing_capacity: null,
    });
    expect(result.can_deactivate).toBe(true);
    expect(result.missing_section_ids).toEqual([]);
    expect(result.warnings.length).toBe(1);
  });

  it("warns about future temporary coverage without blocking", () => {
    const result = planDeactivateDecision({
      role: "Associate",
      owned_sections: [],
      transfers: [],
      open_assignment_count: 0,
      standing_capacity: null,
      future_coverage_count: 1,
    });
    expect(result.can_deactivate).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/temporary coverage/i);
  });

  it("allows deactivate with no sections and no open work", () => {
    const result = planDeactivateDecision({
      role: "Associate",
      owned_sections: [],
      transfers: [],
      open_assignment_count: 0,
      standing_capacity: null,
    });
    expect(result.can_deactivate).toBe(true);
    expect(result.block_reasons).toEqual([]);
  });
});

describe("SECTION-OWNERSHIP-002 source contracts", () => {
  it("lifecycle API requires MasterAdmin and soft-deactivates only", () => {
    const list = readRepo("app/api/roster/lifecycle/route.ts");
    const member = readRepo("app/api/roster/lifecycle/[id]/route.ts");
    expect(list).toMatch(/requireSuperAdmin/);
    expect(member).toMatch(/requireSuperAdmin/);
    expect(member).toMatch(/deactivateRosterAssociate/);
    expect(member).toMatch(/reactivateRosterAssociate/);
    expect(member).not.toMatch(/\.delete\(/);
    expect(member).toMatch(/Standing capacity unchanged|not reclaimed/i);
  });

  it("domain never hard-deletes and does not reclaim ownership on reactivate", () => {
    const src = readRepo("lib/store-ops/roster-lifecycle.ts");
    expect(src).toMatch(/is_active: false, status: "suspended"/);
    expect(src).toMatch(/is_active: true, status: "active"/);
    expect(src).toMatch(/updateOperationalSection/);
    expect(src).not.toMatch(/\.delete\(/);
    expect(src).toMatch(/temporary weekly coverage/);
  });

  it("add associate path defaults onDuty false (schedule-free)", () => {
    const route = readRepo("app/api/roster/members/route.ts");
    expect(route).toMatch(/onDuty:\s*false/);
  });

  it("UI exposes active/inactive/add/deactivate/reactivate", () => {
    const ui = readRepo("components/admin/RosterLifecyclePanel.tsx");
    expect(ui).toMatch(/roster-lifecycle-panel/);
    expect(ui).toMatch(/roster-lifecycle-add/);
    expect(ui).toMatch(/Deactivate/);
    expect(ui).toMatch(/Reactivate/);
    expect(ui).toMatch(/Transfer permanent ownership/);
    expect(ui).not.toMatch(/shift calendar|Shift entry/i);
  });

  it("does not disable AUTO-008 latch or cron", () => {
    expect(WEEKLY_ROTATION_AUTO_PUBLISH).toBe(true);
    const vercel = readRepo("vercel.json");
    expect(vercel).toMatch(/"0 12 \* \* 0"/);
    const lifecycle = readRepo("lib/store-ops/roster-lifecycle.ts");
    expect(lifecycle).not.toMatch(/WEEKLY_ROTATION_AUTO_PUBLISH\s*=/);
    expect(lifecycle).not.toMatch(/DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH/);
  });

  it("Settings More mounts lifecycle panel for MasterAdmin", () => {
    const settings = readRepo("components/sections/SettingsSection.tsx");
    expect(settings).toMatch(/RosterLifecyclePanel/);
    expect(settings).toMatch(/masterSession && activeSpecialist/);
  });
});
