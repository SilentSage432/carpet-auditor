/**
 * UX-REDUCE-002 — Floor This Week presentation contracts.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("UX-REDUCE-002 Floor This Week contracts", () => {
  const floor = readRepo("components/hub/tabs/FloorTab.tsx");
  const board = readRepo("components/store-ops/ThisWeekOwnershipBoard.tsx");

  it("composes people-first ownership board on Floor", () => {
    expect(floor).toContain("ThisWeekOwnershipBoard");
    expect(floor).toContain("composeThisWeekOwnership");
    expect(board).toContain('data-testid="floor-this-week-ownership"');
  });

  it("keeps verification strip conditional and canonical", () => {
    expect(floor).toMatch(
      /pendingVerifyCount > 0[\s\S]*data-testid="floor-verification-strip"/
    );
    expect(floor).not.toContain("Weekly audit rollup");
  });

  it("hides Stage/Assign chrome on healthy path; recovery uses Assign this week", () => {
    expect(floor).toContain("floor-ownership-recovery");
    expect(floor).toContain("Assign this week");
    expect(floor).not.toMatch(/Stage this week/);
    expect(floor).not.toMatch(/Stage \/ assign/);
    expect(floor).not.toContain("Staging week");
  });

  it("preserves Floor Pad entry without analytics drawer", () => {
    expect(floor).toContain("<TacticalVoiceFloorPad");
    expect(floor).not.toContain("ShiftAnalyticsDrawer");
    expect(floor).not.toContain("StoreHealthChart");
    expect(floor).not.toContain("ShiftBriefingCard");
    expect(floor).not.toContain("StoreHealthCard");
  });

  it("removes duplicate Flag Downstock drawer entry", () => {
    expect(floor).not.toContain("Flag Downstock");
    expect(floor).not.toContain("FlagDownstockSheet");
    expect(floor).not.toContain("setDownstockOpen");
  });

  it("demotes fiscal via omitFiscal on context strip", () => {
    expect(floor).toContain("omitFiscal");
  });

  it("does not mount ZebraChecklist as primary Floor composition", () => {
    expect(floor).not.toContain("ZebraChecklist");
  });

  it("keeps associate simplified without supervisor recovery", () => {
    expect(floor).toContain("onlySpecialistId={simplified");
    expect(floor).toContain("allowExtraBay={!simplified && supervisor}");
  });
});

describe("UX-REDUCE-002 ownership board contracts", () => {
  const board = readRepo("components/store-ops/ThisWeekOwnershipBoard.tsx");

  it("exposes Add another bay on person detail via existing extra-bay client", () => {
    expect(board).toContain("suggestExtraBay");
    expect(board).toContain("dispatchExtraBay");
    expect(board).toContain("Add another bay");
  });

  it("keeps barrier as a bay-level action", () => {
    expect(board).toContain("Barrier");
    expect(board).toContain("reportRotationBarriers");
    expect(board).toContain("BarrierReasonChips");
  });

  it("demotes facing check and downstock under Actions", () => {
    expect(board).toContain("Facing check");
    expect(board).toContain("Downstock");
    expect(board).toContain("Actions");
  });
});
