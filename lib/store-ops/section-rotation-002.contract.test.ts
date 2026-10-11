/**
 * DEPTSYNC-SECTION-ROTATION-002 — activation + preview contracts.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("SECTION-ROTATION-002 source contracts", () => {
  it("hard-disables auto-stage constant", () => {
    const src = readRepo("lib/store-ops/section-aware-rotation.ts");
    expect(src).toMatch(
      /export const SECTION_AWARE_ROTATION_AUTO_STAGE = false as const/
    );
  });

  it("Sunday modal keeps default Assign path and gates section-aware UI", () => {
    const modal = readRepo("components/admin/SundayAuditAssignmentModal.tsx");
    expect(modal).toMatch(/isSectionAwarePreviewEnabled/);
    expect(modal).toMatch(/section-aware-assign-preview/);
    expect(modal).toMatch(/PROPOSED/);
    expect(modal).toMatch(/assertSectionAwarePreviewFresh/);
    expect(modal).toMatch(/applySundayAssignmentPlan/);
    expect(modal).toMatch(/buildScheduleBalancePlan/);
    // Preview panel is opt-in — must not replace the existing week-assign-preview.
    expect(modal).toMatch(/data-testid="week-assign-preview"/);
  });

  it("cron weekly-rotation route does not reference section-aware preference", () => {
    const cron = readRepo("app/api/cron/weekly-rotation/route.ts");
    expect(cron).not.toMatch(/section-aware/);
    expect(cron).not.toMatch(/SECTION_AWARE/);
  });
});
