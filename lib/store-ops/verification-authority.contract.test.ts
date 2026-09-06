/**
 * UX-002 — verification authority safety contracts.
 * Guards against reintroducing false bay-verification UI that only stamps
 * department week metadata.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("UX-002 verification authority contracts", () => {
  it("Floor Shift Analytics must not expose false Verify awaiting review CTA", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).not.toContain("Verify awaiting review");
    expect(floor).not.toContain("verifyAllCompletedBays");
    expect(floor).not.toContain("signOffCompleted");
    expect(floor).not.toMatch(/Week signed off[\s\S]*verified/);
  });

  it("Floor keeps canonical verification strip → rollup modal ownership", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).toContain("floor-verification-strip");
    expect(floor).toContain("SupervisorAuditSummaryModal");
    expect(floor).toContain("Awaiting your verification");
    expect(floor).toContain("Weekly audit rollup");
  });

  it("client must not export empty-ID bay-verify helper verifyAllCompletedBays", () => {
    const client = readRepo("lib/store-ops/client.ts");
    expect(client).not.toContain("verifyAllCompletedBays");
    expect(client).toContain("verifyPendingBay");
    expect(client).toContain("verifyAllPendingBays");
    expect(client).toContain("sendBackPendingBay");
  });

  it("canonical modal owns bay verify / send-back / verify-all review_action path", () => {
    const modal = readRepo(
      "components/store-ops/SupervisorAuditSummaryModal.tsx"
    );
    expect(modal).toContain("verifyPendingBay");
    expect(modal).toContain("verifyAllPendingBays");
    expect(modal).toContain("sendBackPendingBay");
    expect(modal).not.toContain("verifyAllCompletedBays");
  });

  it("verify_all may stamp department week only after bay review batch", () => {
    const route = readRepo("app/api/rotations/verify/route.ts");
    expect(route).toContain('reviewAction === "verify_all"');
    expect(route).toContain("verifyAllPendingRotations");
    expect(route).toContain("completedRotationIds: []");
    expect(route).toContain("verifyWeeklyRotations");
  });
});
