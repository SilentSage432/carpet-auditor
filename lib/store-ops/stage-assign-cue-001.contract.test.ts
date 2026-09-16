/**
 * STAGE-ASSIGN-CUE-001 — post-Stage ownership cue is the obvious next step.
 * Presentation/workflow only. Does not rewrite LAB-WEEK-002 allocation.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  expect(start, `${name} missing`).toBeGreaterThan(-1);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(brace, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

describe("STAGE-ASSIGN-CUE-001 user-journey contracts", () => {
  const modal = readRepo("components/admin/SundayAuditAssignmentModal.tsx");
  const floor = readRepo("components/hub/tabs/FloorTab.tsx");

  it("Stage remains selection-only — handleGenerateFlooring does not persist ownership", () => {
    const body = functionBody(modal, "handleGenerateFlooring");
    expect(body).toMatch(/generateRotations/);
    expect(body).not.toMatch(/handleBalanceAssign/);
    expect(body).not.toMatch(/applySundayAssignmentPlan/);
    expect(body).not.toMatch(/setSundayBayAssignment/);
    expect(body).not.toMatch(/autoAssignSundayBaysToSpecialist/);
  });

  it("Floor Stage copy no longer promises assignment", () => {
    expect(floor).not.toMatch(/build the floor plan and assign bays/);
    expect(floor).toMatch(/Prepare this week's coverage to select the bays/);
  });

  it("staged/unowned state exposes schedule-informed confirm as Assign this week", () => {
    expect(modal).toMatch(/data-testid="week-assign-cue"/);
    expect(modal).toMatch(/bays\.length > 0 && pending > 0/);
    expect(modal).toMatch(/data-testid="week-assign-preview"/);
    expect(modal).toMatch(/balancerPlan\.loads/);
    expect(modal).toMatch(/Assign this week/);
    expect(modal).not.toMatch(/Balance & Assign from week schedule/);
  });

  it("Assign this week still routes through handleBalanceAssign and LAB-WEEK-002 writer", () => {
    const confirmIdx = modal.indexOf('data-testid="week-assign-confirm"');
    const nearby = modal.slice(confirmIdx, confirmIdx + 420);
    expect(nearby).toMatch(/handleBalanceAssign/);
    expect(nearby).toMatch(/Assign this week/);
    const balance = functionBody(modal, "handleBalanceAssign");
    expect(balance).toMatch(/fetchShiftDaysRange/);
    expect(balance).toMatch(/composeWeekLaborAvailability/);
    expect(balance).toMatch(/applySundayAssignmentPlan/);
    expect(balance).toMatch(/knownHoursOnly:\s*true|buildScheduleBalancePlan/);
  });

  it("Auto-Assign All to Me remains secondary, not the primary week action", () => {
    expect(modal).toMatch(/Auto-Assign All to Me \(Flooring DS\)/);
    expect(modal).toMatch(/data-testid="auto-assign-me"/);
    const cueIdx = modal.indexOf('data-testid="week-assign-cue"');
    const autoIdx = modal.indexOf('data-testid="auto-assign-me"');
    expect(cueIdx).toBeGreaterThan(-1);
    expect(autoIdx).toBeGreaterThan(-1);
    expect(cueIdx, "week-assign-cue must precede Auto-Assign All to Me").toBeLessThan(
      autoIdx
    );
    const autoSlice = modal.slice(autoIdx, autoIdx + 280);
    expect(autoSlice).not.toMatch(/btn-primary-glow/);
    const confirmSlice = modal.slice(
      modal.indexOf('data-testid="week-assign-confirm"'),
      modal.indexOf('data-testid="week-assign-confirm"') + 280
    );
    expect(confirmSlice).toMatch(/btn-primary-glow/);
  });

  it("insufficient schedule evidence stays fail-closed and does not invent 8 hours", () => {
    expect(modal).toMatch(/data-testid="week-assign-insufficient"/);
    expect(modal).toMatch(/Missing times are not treated as 8 hours/);
    const balance = functionBody(modal, "handleBalanceAssign");
    expect(balance).toMatch(/allocatable\.length === 0/);
    expect(balance).not.toMatch(/hours:\s*8/);
    expect(balance).not.toMatch(/DEFAULT_SHIFT_HOURS/);
  });
});
