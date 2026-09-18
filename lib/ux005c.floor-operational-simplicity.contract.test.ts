/**
 * UX-005C — Floor operational simplicity (presentation / information architecture).
 *
 * AMENDED by SNAP-RETIRE-001: removed Snap Bay Photo.
 * AMENDED by REDUCE-004: disconnected Predictive Copilot from everyday Floor.
 * AMENDED by UX-REDUCE-002: analytics drawer retired from Floor; Floor Pad and
 * demoted showroom tools remain as secondary mounts. Primary actions are no
 * longer Flag Downstock / Weekly rollup — verification is top-level only.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

const floor = readRepo("components/hub/tabs/FloorTab.tsx");

describe("UX-005C / UX-REDUCE-002 Floor secondary tools", () => {
  it("keeps Floor Pad mounted in secondary tools without analytics reports", () => {
    const actionsIdx = floor.indexOf('data-testid="floor-drawer-actions"');
    expect(actionsIdx, "floor-drawer-actions marker missing").toBeGreaterThan(
      -1
    );
    const actionsSlice = floor.slice(actionsIdx, actionsIdx + 800);
    expect(actionsSlice).toContain("<TacticalVoiceFloorPad");
    expect(floor).not.toContain("<ShiftAnalyticsReportsGroup");
    expect(floor).not.toContain("<StoreHealthChart");
    expect(floor).not.toContain("<StoreHealthCard");
    expect(floor).not.toContain("<ShiftBriefingCard");
    expect(floor).not.toContain("<ExceptionFeed");
  });

  it("no longer hosts Snap Bay, Predictive Copilot, or duplicate rollup/downstock", () => {
    expect(floor).not.toContain("Snap Bay Photo");
    expect(floor).not.toContain("<PredictiveCopilotBanner");
    expect(floor).not.toContain("setBayScanOpen");
    expect(floor).not.toContain("Weekly audit rollup");
    expect(floor).not.toContain("Flag Downstock");
  });

  it("Showroom Quick Touch remains reachable but demoted", () => {
    expect(floor).toContain("<ShowroomQuickTouchCard");
    expect(floor).toContain("Showroom tools");
  });
});

describe("UX-005C drawer chrome (component still exists for non-Floor reuse)", () => {
  it("ShiftAnalyticsDrawer file remains in repo", () => {
    expect(
      existsSync(
        path.join(root, "components/store-ops/ShiftAnalyticsDrawer.tsx")
      )
    ).toBe(true);
  });
});
