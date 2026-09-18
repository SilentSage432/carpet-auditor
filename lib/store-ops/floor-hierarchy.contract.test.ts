/**
 * UX-003 Floor decision hierarchy — source contracts.
 * Amended by UX-REDUCE-002: people-first This Week ownership;
 * verification remains conditional ahead of week state / ownership.
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
  it("identity < needs-attention/verify < week state < ownership < tools", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");

    const identityIdx = floor.indexOf('data-testid="floor-command-header"');
    const needsIdx = floor.indexOf('data-testid="floor-needs-attention"');
    const verifyIdx = floor.indexOf('data-testid="floor-verification-strip"');
    const weekStateIdx = floor.indexOf('data-testid="floor-week-state"');
    const weekProgressIdx = floor.indexOf(
      'data-testid="floor-week-progress-line"'
    );
    const ownershipIdx = floor.indexOf("<ThisWeekOwnershipBoard");
    const fiscalIdx = floor.indexOf("<FloorOperationalContextStrip");
    const toolsIdx = floor.indexOf('data-testid="floor-secondary-tools"');

    assertOrder("identity < needs attention", identityIdx, needsIdx);
    assertOrder("needs attention < week state", needsIdx, weekStateIdx);
    assertOrder("week state < week progress", weekStateIdx, weekProgressIdx);
    assertOrder("week state < ownership", weekStateIdx, ownershipIdx);
    assertOrder("ownership < fiscal/season", ownershipIdx, fiscalIdx);
    assertOrder("fiscal < tools", fiscalIdx, toolsIdx);
    // Verification remains nested inside needs-attention when pending.
    expect(verifyIdx).toBeGreaterThan(needsIdx);

    const headerSlice = floor.slice(
      identityIdx,
      floor.indexOf("</header>", identityIdx)
    );
    expect(headerSlice).toContain("{weekTitle}");
    expect(headerSlice).not.toContain("floor-week-progress-line");
    expect(headerSlice).not.toContain("floor-appliances-entry");
  });

  it("without verification, identity still precedes week state and ownership", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    const identityIdx = floor.indexOf('data-testid="floor-command-header"');
    const weekStateIdx = floor.indexOf('data-testid="floor-week-state"');
    const ownershipIdx = floor.indexOf("<ThisWeekOwnershipBoard");

    assertOrder("identity < week state", identityIdx, weekStateIdx);
    assertOrder("week state < ownership", weekStateIdx, ownershipIdx);

    expect(floor).toMatch(
      /pendingVerifyCount > 0 \? \([\s\S]*data-testid="floor-verification-strip"/
    );
  });

  it("UX-REDUCE-002: people-first ownership replaces bay-filter SI collision", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).not.toContain('label: "Open issues"');
    expect(floor).not.toContain('label: "Needs Attention"');
    expect(floor).toContain("shouldShowFloorAttentionSummary");
    expect(floor).toContain("ThisWeekOwnershipBoard");
  });
});
