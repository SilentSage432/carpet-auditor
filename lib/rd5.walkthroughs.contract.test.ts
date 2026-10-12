/**
 * RD-5 contract — Walkthroughs surface, Map history, rotation independence.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function repoExists(rel: string): boolean {
  return existsSync(join(root, rel));
}

describe("RD-5 Walkthroughs contracts", () => {
  it("ships additive walkthrough migration with store-scoped RLS read", () => {
    expect(repoExists("supabase/migrations/20261012_walkthroughs.sql")).toBe(
      true
    );
    const sql = readSrc("supabase/migrations/20261012_walkthroughs.sql");
    expect(sql).toMatch(/walkthrough_sessions/);
    expect(sql).toMatch(/walkthrough_observations/);
    expect(sql).toMatch(/walkthrough_follow_ups/);
    expect(sql).toMatch(/observation_type in \('positive', 'opportunity', 'general'\)/);
    expect(sql).toMatch(/jwt_matches_store/);
    expect(sql).toMatch(/No authenticated INSERT/);
    expect(sql).not.toMatch(/weekly_rotations/);
    expect(sql).not.toMatch(/sunday_bay_assignments/);
  });

  it("exposes store-scoped walkthrough APIs", () => {
    expect(repoExists("app/api/walkthroughs/route.ts")).toBe(true);
    expect(repoExists("app/api/walkthroughs/observations/route.ts")).toBe(true);
    expect(repoExists("app/api/walkthroughs/follow-ups/[id]/route.ts")).toBe(
      true
    );
    const inbox = readSrc("app/api/walkthroughs/route.ts");
    const create = readSrc("app/api/walkthroughs/observations/route.ts");
    const complete = readSrc("app/api/walkthroughs/follow-ups/[id]/route.ts");
    expect(inbox).toMatch(/requireStoreOpsActor/);
    expect(create).toMatch(/requireSupervisorOrAdmin/);
    expect(create).toMatch(/resolveStoreByNumber/);
    expect(complete).toMatch(/requireSupervisorOrAdmin/);
    expect(create).not.toMatch(/handleBalanceAssign|stageSunday|verifyBay/);
  });

  it("Walkthroughs tab is functional (not placeholder) with empty state", () => {
    const tab = readSrc("components/hub/tabs/WalkthroughsTab.tsx");
    expect(tab).toMatch(/Begin walkthrough/);
    expect(tab).toMatch(/walkthrough-empty/);
    expect(tab).toMatch(/fetchWalkthroughInbox/);
    expect(tab).toMatch(/Needs attention/);
    expect(tab).not.toMatch(/Walkthrough capture is coming next/);
    expect(tab).toMatch(/not scoring/i);
    expect(tab).not.toMatch(/leaderboard|employee score|ranking/i);
  });

  it("Overview consumes real follow-up inbox", () => {
    const overview = readSrc("components/hub/tabs/OverviewTab.tsx");
    expect(overview).toMatch(/fetchWalkthroughInbox/);
    expect(overview).not.toMatch(/Walkthrough follow-ups are not stored yet/);
  });

  it("Map bay sheet exposes walkthrough history without aisle-index clutter", () => {
    const sheet = readSrc("components/admin/WalkTheFloorSheet.tsx");
    expect(sheet).toMatch(/walk-sheet-walkthrough-history/);
    expect(sheet).toMatch(/fetchWalkthroughPlaceHistory/);
    const map = readSrc("components/hub/tabs/MapTab.tsx");
    expect(map).not.toMatch(/fetchWalkthroughPlaceHistory/);
  });

  it("WALK-002 Map bay sheet records place-bound observations", () => {
    const sheet = readSrc("components/admin/WalkTheFloorSheet.tsx");
    expect(sheet).toMatch(/walk-sheet-record-observation/);
    expect(sheet).toMatch(/Record Observation/);
    expect(sheet).toMatch(/WalkthroughCaptureSheet/);
    expect(sheet).toMatch(/placeLocked/);
    expect(sheet).toMatch(/initialAisle=\{bay\.aisle\}/);
    expect(sheet).toMatch(/initialBay=\{bay\.pair\.bay\}/);
    expect(sheet).toMatch(/initialDepartmentId=\{bay\.departmentId\}/);
    const capture = readSrc(
      "components/walkthroughs/WalkthroughCaptureSheet.tsx"
    );
    expect(capture).toMatch(/walkthrough-capture-section-owner/);
    expect(capture).toMatch(/More options/);
    expect(capture).toMatch(/placeLocked/);
    const observations = readSrc("app/api/walkthroughs/observations/route.ts");
    expect(observations).toMatch(/ensureActiveWalkthroughSession/);
    expect(observations).toMatch(/resolveWalkthroughPlaceOwnership/);
    const domain = readSrc("lib/store-ops/walkthroughs.ts");
    expect(domain).toMatch(/composeWalkthroughPlaceOwnership/);
    expect(domain).toMatch(/assertCanonicalWalkthroughPlace/);
    expect(domain).toMatch(/ensureActiveWalkthroughSession/);
    expect(domain).not.toMatch(/sunday_bay_assignments/);
  });

  it("domain stays independent of rotation mutation", () => {
    const domain = readSrc("lib/store-ops/walkthroughs.ts");
    expect(domain).not.toMatch(/sunday_bay_assignments/);
    expect(domain).not.toMatch(/weekly_rotations/);
    expect(domain).not.toMatch(/applySundayAssignmentPlan/);
    expect(domain).not.toMatch(/handleBalanceAssign/);
    expect(domain).toMatch(/Do not mutate weekly rotations/);
  });

  it("RD-5-FIX store-scopes specialist and section soft references", () => {
    const domain = readSrc("lib/store-ops/walkthroughs.ts");
    expect(domain).toMatch(/assertRosterSpecialistForStore/);
    expect(domain).toMatch(/assertOperationalSectionForStore/);
    expect(domain).toMatch(/loadOperationalSectionForStore/);
    expect(domain).toMatch(/storeNumberQueryValues/);
    expect(repoExists("lib/store-ops/walkthroughs.authz.test.ts")).toBe(true);
    const sessions = readSrc("app/api/walkthroughs/sessions/route.ts");
    const observations = readSrc("app/api/walkthroughs/observations/route.ts");
    expect(sessions).toMatch(/store_number: store\.store_number/);
    expect(observations).toMatch(/store_number: store\.store_number/);
  });

  it("Floor Pad remains available and not overloaded as substrate", () => {
    const tab = readSrc("components/hub/tabs/WalkthroughsTab.tsx");
    expect(tab).toMatch(/buildExecutiveFloorPadHref/);
    expect(tab).toMatch(/Open Floor Pad/);
    expect(repoExists("lib/store-ops/manager-notes.ts")).toBe(true);
    const domain = readSrc("lib/store-ops/walkthroughs.ts");
    expect(domain).not.toMatch(/from\("manager_notes"\)/);
    expect(domain).not.toMatch(/shift_walk_tasks/);
  });

  it("implementation report exists", () => {
    expect(
      repoExists("docs/product/DEPTSYNC_RD_5_WALKTHROUGHS.md")
    ).toBe(true);
  });

  it("WALK-005 wires follow-up-later UI onto existing API", () => {
    const client = readSrc("lib/store-ops/client.ts");
    expect(client).toMatch(/createWalkthroughFollowUpClient/);
    expect(client).toMatch(/\/api\/walkthroughs\/follow-ups/);
    expect(repoExists("components/walkthroughs/ObservationDetailSheet.tsx")).toBe(
      true
    );
    const detail = readSrc("components/walkthroughs/ObservationDetailSheet.tsx");
    expect(detail).toMatch(/createWalkthroughFollowUpClient/);
    expect(detail).toMatch(/observation-add-follow-up/);
    expect(detail).toMatch(/Close with evidence/);
    const tab = readSrc("components/hub/tabs/WalkthroughsTab.tsx");
    expect(tab).toMatch(/ObservationDetailSheet/);
    expect(tab).toMatch(/walkthrough-review-observations/);
    expect(tab).toMatch(/Needs follow-up decision/);
    const domain = readSrc("lib/store-ops/walkthroughs.ts");
    expect(domain).toMatch(/isObservationAwaitingFollowUpDecision/);
    expect(domain).toMatch(/review_observations/);
    expect(domain).toMatch(/awaiting_follow_up_decision/);
    const overview = readSrc("components/hub/tabs/OverviewTab.tsx");
    expect(overview).toMatch(/overview-walkthrough-review-hint/);
    expect(overview).not.toMatch(/review_count.*attention/);
  });
});
