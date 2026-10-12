/**
 * DEPTSYNC-RD-4 — This Week command board source contracts.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("RD-4 This Week command board", () => {
  it("ships command summary + ownership board on FloorTab", () => {
    const floor = readSrc("components/hub/tabs/FloorTab.tsx");
    expect(floor).toMatch(/ThisWeekCommandSummaryCard/);
    expect(floor).toMatch(/composeThisWeekCommandSummary/);
    expect(floor).toMatch(/includeUnassignedRoster/);
    expect(floor).toMatch(/baySectionByKey/);
    expect(floor).toMatch(/fetchOperationalSections/);
    expect(floor).toMatch(/ThisWeekOwnershipBoard/);
    expect(floor).toMatch(/SupervisorAuditSummaryModal/);
    expect(floor).toMatch(/dispatchExtraBay|allowExtraBay/);
    expect(floor).not.toMatch(/selectPhysicalBayCoverage/);
    expect(floor).not.toMatch(/weekly_bay_target/);
  });

  it("keeps assignment distinct from completion evidence in domain + UI", () => {
    const domain = readSrc("lib/store-ops/this-week-ownership.ts");
    expect(domain).toMatch(/composeThisWeekCommandSummary/);
    expect(domain).toMatch(/assignmentResponsibilityLabel/);
    expect(domain).toMatch(/completionEvidenceLabel/);
    expect(domain).toMatch(/SHARED_TEAM_WEEKLY_CAPACITY/);
    expect(domain).toMatch(/Assignment ≠ proof of work/);

    const summary = readSrc("components/store-ops/ThisWeekCommandSummary.tsx");
    expect(summary).toMatch(/this-week-command-summary/);
    expect(summary).toMatch(/week-summary-evidence-note/);
    expect(summary).toMatch(/scheduled bay is not proof/);
    expect(summary).toMatch(/In Zebra/);
    expect(summary).toMatch(/operator-recorded/);
    expect(summary).toMatch(/eligible ×/);
    expect(summary).toMatch(/not a fixed/);

    const board = readSrc("components/store-ops/ThisWeekOwnershipBoard.tsx");
    expect(board).toMatch(/assignmentResponsibilityLabel/);
    expect(board).toMatch(/completionEvidenceLabel/);
    expect(board).toMatch(/zebraHandoffEvidenceLabel/);
    expect(board).toMatch(/buildMapBayFocusHref/);
    expect(board).toMatch(/formatUnsectionedLabel/);
    expect(board).toMatch(/completeRotation/);
    expect(board).toMatch(/reportRotationBarriers/);
    expect(board).toMatch(/confirmZebraBayEntry/);
  });

  it("Map accepts This Week bay focus without rewriting geography", () => {
    expect(existsSync(join(root, "lib/store-ops/map-bay-focus.ts"))).toBe(true);
    const map = readSrc("components/hub/tabs/MapTab.tsx");
    expect(map).toMatch(/resolveMapBayFocusIntent/);
    expect(map).toMatch(/focusAisle=/);
    const grid = readSrc("components/admin/StoreLocationGrid.tsx");
    expect(grid).toMatch(/focusAisle/);
    expect(grid).toMatch(/RD-4 This Week → Map focus/);
  });

  it("does not rewrite Sunday engine or capacity", () => {
    const domain = readSrc("lib/store-ops/this-week-ownership.ts");
    expect(domain).toMatch(/Does not persist, invent owners, or change engine/);
    expect(domain).toMatch(/eligibleAssociateCount/);
    const sunday = readSrc("lib/store-ops/sunday-dispatch.ts");
    // Engine file still owns automatic target — RD-4 must not have edited it.
    expect(sunday).toMatch(/resolveAutomaticWeeklyBayTarget/);
  });
});
