/**
 * UX-REDUCE-007 — final legacy surface & residue retirement.
 *
 * Mounted product must match the reduced rotation instrument.
 * Schema, dormant specialty runtime, and engine models stay unless proven dead.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composePhysicalBayManualPriority } from "./physical-bay-priority";
import { velocitySeedFromPreset } from "./velocity";
import { resolveAutomaticWeeklyBayTarget } from "./week";
import { BASE_WEEKLY_BAY_QUOTA } from "./weekly-rotations";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("UX-REDUCE-007 call-out must not manufacture manual High", () => {
  it("stampCarryOverLocations does not write priority_override", () => {
    const callOut = readRepo("lib/store-ops/call-out.ts");
    expect(callOut).not.toMatch(/priority_override:\s*true/);
    expect(callOut).toMatch(/status:\s*"CARRIED_OVER"/);
    expect(callOut).toMatch(/carried_over:\s*true/);
  });

  it("default Roster call-out still does not touch location priority", () => {
    const roster = readRepo("components/hub/tabs/RosterTab.tsx");
    const recordAt = roster.indexOf("async function recordCallOut");
    const reassignAt = roster.indexOf("async function applyReassign");
    const recordFn = roster.slice(recordAt, reassignAt);
    expect(recordFn).not.toMatch(/priority_override/);
    expect(recordFn).not.toMatch(/patchStoreLocation/);
    expect(recordFn).toMatch(/upsertShiftDay/);
  });

  it("existing High / Standard composition is independent of call-out", () => {
    expect(
      composePhysicalBayManualPriority([
        { priority_override: true },
        { priority_override: false },
      ])
    ).toBe("high");
    expect(
      composePhysicalBayManualPriority([{ priority_override: false }])
    ).toBe("standard");
  });
});

describe("UX-REDUCE-007 remaining priority_override writers", () => {
  it("canonical Map writers remain physical-bay and aisle High", () => {
    const physical = readRepo("lib/store-ops/physical-bay-priority.ts");
    const aisle = readRepo("lib/store-ops/aisle-priority.ts");
    expect(physical).toMatch(/priority_override: nextOverride/);
    expect(aisle).toMatch(/priority_override: input.priority === true/);
    expect(readRepo("components/admin/StoreLocationGrid.tsx")).toMatch(
      /canMutateRotationPriority/
    );
    expect(readRepo("components/admin/WalkTheFloorSheet.tsx")).toMatch(
      /data-testid="map-bay-priority"/
    );
  });

  it("bulk topology defaults to Standard rather than Priority Lock", () => {
    expect(velocitySeedFromPreset("standard")).toEqual({
      velocity_tier: "standard",
      priority_override: false,
      custom_decay_days: 14,
    });
    const generator = readRepo("components/admin/BulkLocationGenerator.tsx");
    expect(generator).toContain('parseVelocitySeedPreset("standard")');
    expect(generator).not.toMatch(/Priority Lock/);
    expect(generator).not.toMatch(/priority_lock/);
    expect(generator).not.toMatch(/setVelocitySeed/);
  });

  it("call-out is not among remaining writers", () => {
    expect(readRepo("lib/store-ops/call-out.ts")).not.toMatch(
      /priority_override:\s*true/
    );
    expect(readRepo("components/hub/tabs/RosterTab.tsx")).not.toMatch(
      /priority_override:\s*true/
    );
  });
});

describe("UX-REDUCE-007 retired mounted surfaces", () => {
  it("unmounts Bulk Priority Lock, velocity radios, and Bay Workflow", () => {
    const generator = readRepo("components/admin/BulkLocationGenerator.tsx");
    const edit = readRepo("components/admin/EditBayDrawer.tsx");
    expect(generator).not.toMatch(/Default velocity tier/);
    expect(generator).not.toMatch(/High Velocity \/ Fast Mover/);
    expect(generator).not.toMatch(/Bay workflow/);
    expect(generator).not.toMatch(/handleApplyDepartmentWorkflow/);
    expect(edit).not.toMatch(/Bay workflow/);
    expect(edit).toMatch(/Save bay/);
    expect(edit).toMatch(/Delete bay/);
  });

  it("unmounts taxonomy, fiscal, weekly-target, and specialty cache chrome from More", () => {
    const settings = readRepo("components/sections/SettingsSection.tsx");
    expect(settings).not.toContain("WeeklyBayTargetCard");
    expect(settings).not.toContain("FiscalCoverageCard");
    expect(settings).not.toContain("TaxonomyManagerModal");
    expect(settings).not.toMatch(/Catalog taxonomies/);
    expect(settings).not.toMatch(/Appliance audit cache/);
    expect(settings).not.toMatch(/Remnant inventory cache/);
    expect(settings).toMatch(/Pending queue/);
    expect(settings).toMatch(/Blocked \(quarantined\)/);
    expect(settings).toContain('data-testid="more-executive-floor-pad"');
    expect(settings).toContain("OperationalContextCard");
    expect(settings).toContain("SundayScheduleCard");
  });

  it("topology cadence chips no longer say HIGH / CRITICAL", () => {
    const more = readRepo("components/admin/AisleBayManager.tsx");
    expect(more).toMatch(/Service hotspot/);
    expect(more).toMatch(/Fast cadence/);
    expect(more).not.toMatch(/return "CRITICAL"/);
    expect(more).not.toMatch(/return "HIGH"/);
    expect(more).toMatch(/priority_override/);
    expect(more).toMatch(/>\s*High\s*</);
  });
});

describe("UX-REDUCE-007 Walk / Floor Pad wording", () => {
  it("reserves High priority copy for Map manual High", () => {
    const walk = readRepo("components/admin/WalkTheFloorSheet.tsx");
    expect(walk).toMatch(/True hole/);
    expect(walk).not.toMatch(/True Hole \/ High Priority/);
    expect(walk).toMatch(/Mark high priority/);
    const pad = readRepo("components/dashboard/TacticalVoiceFloorPad.tsx");
    expect(pad).toMatch(/Urgent observation/);
    expect(pad).toMatch(/Elevated observation/);
    expect(pad).toMatch(/Routine note/);
    expect(pad).not.toMatch(/card\.priority\.replace\("_", " "\)/);
  });
});

describe("UX-REDUCE-007 protected shells and engine laws", () => {
  it("automatic plan remains eligible × 3", () => {
    expect(BASE_WEEKLY_BAY_QUOTA).toBe(3);
    expect(resolveAutomaticWeeklyBayTarget(4)).toBe(12);
    expect(resolveAutomaticWeeklyBayTarget(0)).toBe(0);
    const sunday = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(sunday).toMatch(/resolveAutomaticWeeklyBayTarget\(/);
    expect(sunday).toMatch(/BASE_WEEKLY_BAY_QUOTA/);
  });

  it("More still hosts Floor Pad and Seasonal; SpecialtyToolsHost remains dormant", () => {
    const settings = readRepo("components/sections/SettingsSection.tsx");
    const shell = readRepo("components/hub/WorkflowTabShell.tsx");
    expect(settings).toContain('title="Floor Pad"');
    expect(settings).toContain('title="Department Setup"');
    expect(settings).toContain('title="Rotation Setup"');
    expect(settings).toContain('title="Device & Account"');
    expect(settings).toContain('title="Master Admin"');
    expect(settings).toContain("OperationalContextCard");
    expect(shell).toContain("SpecialtyToolsHost");
    expect(shell).toContain("seedVisitedTabs");
    expect(shell).toContain('visited.has("/settings")');
  });

  it("Floor stays weekly ownership; Map stays topology-non-mutating except priority", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    const map = readRepo("components/hub/tabs/MapTab.tsx");
    const grid = readRepo("components/admin/StoreLocationGrid.tsx");
    const roster = readRepo("components/hub/tabs/RosterTab.tsx");
    expect(floor).toContain("ThisWeekOwnershipBoard");
    expect(floor).not.toMatch(/setPhysicalBayRotationPriority/);
    expect(floor).not.toMatch(/WeeklyBayTargetCard|TaxonomyManagerModal|FiscalCoverageCard/);
    expect(map).toContain("StoreLocationGrid");
    expect(grid).toContain("canMutate={false}");
    expect(grid).toMatch(/canMutateRotationPriority/);
    expect(roster).toMatch(/formatPeopleCount/);
    expect(roster).toMatch(/Called out|called out/);
  });
});
