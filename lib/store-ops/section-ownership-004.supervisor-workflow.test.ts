/**
 * DEPTSYNC-SECTION-OWNERSHIP-004 — supervisor workflow composition contracts.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEEKLY_ROTATION_AUTO_PUBLISH } from "./authoritative-week-cycle";
import {
  COVERAGE_CAPACITY_EXPLAINER,
  composeRotationVisibilityStatus,
  composeStandingCapacityStatus,
  PERMANENT_OWNER_LABEL,
  TEMPORARY_COVERAGE_LABEL,
} from "./supervisor-ownership-workflow";

function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("SECTION-OWNERSHIP-004 standing + rotation visibility", () => {
  it("does not invent standing capacity when policy absent", () => {
    const status = composeStandingCapacityStatus({
      schema_ready: true,
      policy: null,
    });
    expect(status.established).toBe(false);
    expect(status.sum).toBeNull();
  });

  it("sums active standing items without inventing policy", () => {
    const status = composeStandingCapacityStatus({
      schema_ready: true,
      policy: {
        is_active: true,
        policy_version: 1,
        items: [
          { approved_capacity: 3 },
          { approved_capacity: 3 },
          { approved_capacity: 3 },
          { approved_capacity: 3 },
        ],
      },
    });
    expect(status.established).toBe(true);
    expect(status.sum).toBe(12);
  });

  it("composes rotation visibility from latch + standing + published count", () => {
    const status = composeRotationVisibilityStatus({
      upcoming_operational_week: "2026-W44",
      standing: {
        schema_ready: true,
        policy: {
          is_active: true,
          policy_version: 1,
          items: [{ approved_capacity: 3 }, { approved_capacity: 3 }],
        },
      },
      published_assignment_count: 0,
    });
    expect(status.automatic_publication_configured).toBe(
      WEEKLY_ROTATION_AUTO_PUBLISH
    );
    expect(status.standing_capacity_established).toBe(true);
    expect(status.assignment_state).toBe("pending");
    expect(status.summary_lines.join(" ")).toMatch(/2026-W44/);
    expect(status.summary_lines.join(" ")).toMatch(/not yet published/i);
    expect(status.summary_lines.join(" ")).toMatch(
      /not proof this week was published/i
    );
  });

  it("marks published when assignment count is positive", () => {
    const status = composeRotationVisibilityStatus({
      upcoming_operational_week: "2026-W43",
      standing: { schema_ready: false, policy: null },
      published_assignment_count: 12,
    });
    expect(status.assignment_state).toBe("published");
    expect(status.standing_capacity_established).toBe(false);
  });
});

describe("SECTION-OWNERSHIP-004 UX copy + demotion contracts", () => {
  it("exports clear permanent vs temporary language", () => {
    expect(PERMANENT_OWNER_LABEL).toMatch(/Permanent/i);
    expect(TEMPORARY_COVERAGE_LABEL).toMatch(/Temporary/i);
    expect(COVERAGE_CAPACITY_EXPLAINER).toMatch(/does not increase/i);
  });

  it("More demotes schedules and mounts workflow card", () => {
    const ui = readRepo("components/sections/SettingsSection.tsx");
    expect(ui).toMatch(/SupervisorOwnershipWorkflowCard/);
    expect(ui).toMatch(/more-optional-schedules/);
    expect(ui).toMatch(/schedule-free lifecycle/);
    expect(ui).not.toMatch(/People, schedules, and availability/);
  });

  it("coverage UI uses capacity explainer and permanent owner label", () => {
    const ui = readRepo("components/admin/OperationalSectionsPanel.tsx");
    expect(ui).toMatch(/COVERAGE_CAPACITY_EXPLAINER/);
    expect(ui).toMatch(/PERMANENT_OWNER_LABEL/);
    expect(ui).toMatch(/TEMPORARY_COVERAGE_LABEL/);
    expect(ui).toMatch(/sections-list-coverage-week/);
  });

  it("roster lifecycle surfaces ownership and covering annotations", () => {
    const ui = readRepo("components/admin/RosterLifecyclePanel.tsx");
    expect(ui).toMatch(/roster-lifecycle-owns-/);
    expect(ui).toMatch(/roster-lifecycle-covers-/);
    expect(ui).toMatch(/fetchSectionWeekCoverage/);
  });

  it("does not disable AUTO-008 latch or invent a publisher", () => {
    expect(WEEKLY_ROTATION_AUTO_PUBLISH).toBe(true);
    const domain = readRepo("lib/store-ops/supervisor-ownership-workflow.ts");
    expect(domain).not.toMatch(/WEEKLY_ROTATION_AUTO_PUBLISH\s*=\s*(true|false)/);
    expect(domain).not.toMatch(/upsert_sunday_bay_assignments/);
  });

  it("People tab no longer leads with Schedule & availability", () => {
    const ui = readRepo("components/hub/tabs/RosterTab.tsx");
    expect(ui).toMatch(/Shifts are optional/);
    expect(ui).not.toMatch(/Schedule &amp; availability ·/);
  });
});
