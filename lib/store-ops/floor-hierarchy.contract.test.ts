/**
 * UX-003 Floor decision hierarchy — source contracts.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function assertOrder(label: string, earlier: number, later: number) {
  expect(earlier, `${label}: earlier marker missing`).toBeGreaterThan(-1);
  expect(later, `${label}: later marker missing`).toBeGreaterThan(-1);
  expect(earlier, label).toBeLessThan(later);
}

describe("UX-003 Floor decision hierarchy contracts", () => {
  it("identity < verification < week state < work < attention < context < tools", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");

    const identityIdx = floor.indexOf('data-testid="floor-command-header"');
    const verifyIdx = floor.indexOf('data-testid="floor-verification-strip"');
    const weekStateIdx = floor.indexOf('data-testid="floor-week-state"');
    const weekProgressIdx = floor.indexOf(
      'data-testid="floor-week-progress-line"'
    );
    const freshnessIdx = floor.indexOf('data-testid="floor-readiness-line"');
    const workIdx = floor.indexOf('data-testid="floor-work-surface"');
    const attentionIdx = floor.indexOf("<FloorAttentionSummary");
    const fiscalIdx = floor.indexOf("<FloorOperationalContextStrip");
    const analyticsIdx = floor.indexOf("<ShiftAnalyticsDrawer");

    assertOrder("identity < verification", identityIdx, verifyIdx);
    assertOrder("verification < week state", verifyIdx, weekStateIdx);
    assertOrder("week state < week progress", weekStateIdx, weekProgressIdx);
    assertOrder("week progress < freshness", weekProgressIdx, freshnessIdx);
    assertOrder("week state < work", weekStateIdx, workIdx);
    assertOrder("work < attention", workIdx, attentionIdx);
    assertOrder("work < fiscal", workIdx, fiscalIdx);
    assertOrder("work < tools", workIdx, analyticsIdx);
    assertOrder("attention < fiscal", attentionIdx, fiscalIdx);
    assertOrder("fiscal < tools", fiscalIdx, analyticsIdx);

    // Command header is identity-only (title), not week telemetry.
    const headerSlice = floor.slice(
      identityIdx,
      floor.indexOf("</header>", identityIdx)
    );
    expect(headerSlice).toContain("{rotationTitle}");
    expect(headerSlice).not.toContain("floor-week-progress-line");
    expect(headerSlice).not.toContain("floor-readiness-line");
  });

  it("without verification, identity still precedes week state and work", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    const identityIdx = floor.indexOf('data-testid="floor-command-header"');
    const weekStateIdx = floor.indexOf('data-testid="floor-week-state"');
    const workIdx = floor.indexOf('data-testid="floor-work-surface"');

    assertOrder("identity < week state", identityIdx, weekStateIdx);
    assertOrder("week state < work", weekStateIdx, workIdx);

    // Verification remains conditional — no reserved blank when absent.
    expect(floor).toMatch(
      /pendingVerifyCount > 0 \? \([\s\S]*data-testid="floor-verification-strip"/
    );
  });

  it("renames bay filter away from SI Current Attention collision", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).toContain('label: "Open issues"');
    expect(floor).not.toContain('label: "Needs Attention"');
    expect(floor).toContain("shouldShowFloorAttentionSummary");
    expect(floor).toContain("composeFloorFreshnessLine");
  });

  it("demotes Shift Analytics chrome to secondary More tools", () => {
    const drawer = readRepo("components/store-ops/ShiftAnalyticsDrawer.tsx");
    expect(drawer).toContain("More tools");
    expect(drawer).toContain("Secondary");
    expect(drawer).not.toContain(">Shift Analytics<");
  });
});
