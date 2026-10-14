/**
 * DEPTSYNC-OPS-OVERVIEW-001 — Overview command composition regressions.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildWalkthroughObservationHref,
  composeOverviewAttention,
  composeOverviewOpenFollowUps,
  composeOverviewOwnerLabel,
  composeOverviewPeopleRows,
  composeOverviewPriorityRows,
  composeOverviewReviewRows,
  overviewPlaceMapHref,
} from "./overview-command";
import { composeThisWeekOwnership } from "./this-week-ownership";
import { composeWalkthroughInbox } from "./walkthroughs";
import { STRICT_SECTION_OWNERSHIP_AUTO_STAGE } from "./section-ownership-enforcement";
import { NAMED_SPECIALTY_ZONE_CODES } from "./aisle";
import type { WeeklyRotationWithLocation } from "./types";

const root = process.cwd();

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function rotation(
  id: string,
  aisle: string,
  bay: number,
  opts?: Partial<WeeklyRotationWithLocation>
): WeeklyRotationWithLocation {
  const location = {
    id: `loc-${id}`,
    store_id: "store-1",
    department_id: "dept-f",
    aisle,
    bay,
    type: "SELLING" as const,
    status: "PENDING",
    is_active: true,
    location_type: "STANDARD" as const,
  };
  return {
    id,
    store_id: "store-1",
    department_id: "dept-f",
    location_id: location.id,
    assigned_week: "2026-W42",
    is_completed: false,
    verification_status: "PENDING",
    store_locations: location as WeeklyRotationWithLocation["store_locations"],
    ...opts,
  } as WeeklyRotationWithLocation;
}

describe("OPS-OVERVIEW-001 composition", () => {
  it("builds walkthrough and map deep-links from place evidence", () => {
    expect(buildWalkthroughObservationHref("obs-1")).toBe(
      "/walkthroughs?observation=obs-1"
    );
    expect(
      overviewPlaceMapHref({
        department_id: "dept-f",
        aisle: "5",
        bay: 12,
      })
    ).toContain("/admin/store-map?");
    expect(overviewPlaceMapHref({ aisle: "", bay: 1 })).toBeNull();
  });

  it("composes honest owner labels without inventing stewards", () => {
    expect(
      composeOverviewOwnerLabel({
        sectionName: "Tyson 5/6",
        ownerName: "Tyson",
      })
    ).toBe("Tyson 5/6 · Tyson");
    expect(
      composeOverviewOwnerLabel({ ownershipAmbiguous: true })
    ).toBe("Section ownership unclear");
    expect(
      composeOverviewOwnerLabel({ ownershipMissing: true, sectionName: "X" })
    ).toBe("No section owner");
  });

  it("surfaces overdue follow-ups in attention without counting review opportunities", () => {
    const inbox = composeWalkthroughInbox({
      sessions: [],
      observations: [
        {
          id: "o1",
          store_id: "s",
          session_id: "sess",
          observation_type: "opportunity",
          body: "Needs decision",
          associate_specialist_id: null,
          section_id: "sec-1",
          department_id: "dept-f",
          aisle: "41",
          bay: 2,
          observed_at: "2026-10-10T12:00:00Z",
          created_by_specialist_id: null,
          created_at: "2026-10-10T12:00:00Z",
          updated_at: "2026-10-10T12:00:00Z",
          section_name: "Tracy 41/42",
          place_label: "Aisle 41 · Bay 2",
        },
      ],
      followUps: [
        {
          id: "f1",
          store_id: "s",
          observation_id: "o-overdue",
          session_id: "sess",
          action_text: "Restock endcap",
          responsible_specialist_id: null,
          due_on: "2026-10-01",
          status: "open",
          completion_evidence: null,
          resolution_notes: null,
          completed_at: null,
          completed_by_specialist_id: null,
          created_by_specialist_id: null,
          created_at: "2026-10-01T12:00:00Z",
          updated_at: "2026-10-01T12:00:00Z",
          place_label: "Aisle 5 · Bay 1",
          section_name: "Tyson 5/6",
          section_id: "sec-t",
          department_id: "dept-f",
          aisle: "5",
          bay: 1,
        },
      ],
      todayIsoDate: "2026-10-14",
    });

    expect(inbox.attention_count).toBe(1);
    expect(inbox.review_count).toBe(1);

    const attention = composeOverviewAttention({
      plan: composeThisWeekOwnership({
        rotations: [rotation("r1", "5", 1)],
        assignments: {
          r1: {
            specialist_id: "ty",
            specialist_name: "Tyson",
            assigned_at: "2026-10-12T12:00:00Z",
          },
        },
      }),
      inbox,
      sections: [
        {
          id: "sec-t",
          name: "Tyson 5/6",
          primary_owner_name: "Tyson",
          primary_owner_specialist_id: "ty",
        },
      ],
    });

    const overdue = attention.find((a) => a.kind === "followup_overdue");
    expect(overdue?.label).toBe("Restock endcap");
    expect(overdue?.href).toContain("observation=");
    expect(overdue?.mapHref).toContain("aisle=5");
    expect(overdue?.ownerLabel).toContain("Tyson");
    expect(attention.every((a) => a.kind !== "followup_overdue" || a.id.startsWith("fu-"))).toBe(
      true
    );

    const review = composeOverviewReviewRows({ inbox });
    expect(review).toHaveLength(1);
    expect(review[0]?.href).toContain("observation=o1");
    expect(review[0]?.label).toBe("Needs decision");

    const open = composeOverviewOpenFollowUps({ inbox });
    expect(open[0]?.needsAttention).toBe(true);
  });

  it("labels next-week priorities as intent, not assignments", () => {
    const rows = composeOverviewPriorityRows({
      weekLabel: "2026-W43",
      priorities: [
        {
          id: "p1",
          store_id: "s",
          store_number: "2587",
          week_label: "2026-W43",
          week_starting: "2026-10-19",
          department_id: "dept-f",
          aisle: "43",
          bay: 4,
          section_id: "sec-n",
          section_name: "Nick 43/44",
          owner_specialist_id: "nick",
          prioritized_by_specialist_id: "ty",
          created_at: "2026-10-14T12:00:00Z",
          revoked_at: null,
          revoked_by_specialist_id: null,
          physical_key: "dept-f|43|4",
          active: true,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.intentNote).toMatch(/not an assignment/i);
    expect(rows[0]?.mapHref).toContain("aisle=43");
    expect(rows[0]?.label).toMatch(/43/);
  });

  it("people rows prefer section stewardship from owned bays when present", () => {
    const plan = composeThisWeekOwnership({
      rotations: [rotation("r1", "5", 1)],
      assignments: {
        r1: {
          specialist_id: "ty",
          specialist_name: "Tyson",
          assigned_at: "2026-10-12T12:00:00Z",
        },
      },
      baySectionByKey: new Map([
        [
          "dept-f|5|1",
          {
            section_id: "sec-t",
            section_name: "Tyson 5/6",
            department_id: "dept-f",
            primary_owner_specialist_id: "ty",
            primary_owner_name: "Tyson",
            is_active: true,
          },
        ],
      ]),
    });
    const people = composeOverviewPeopleRows(plan);
    expect(people[0]?.sectionLabel).toBe("Tyson 5/6");
  });
});

describe("OPS-OVERVIEW-001 source contracts", () => {
  it("Overview wires composers and does not invent urgency scores", () => {
    const overview = readRepo("components/hub/tabs/OverviewTab.tsx");
    expect(overview).toMatch(/composeOverviewAttention/);
    expect(overview).toMatch(/fetchWeekBayPriorities/);
    expect(overview).toMatch(/fetchWalkthroughInbox/);
    expect(overview).toMatch(/overview-followups-unavailable/);
    expect(overview).toMatch(/intentNote|priority is intent/i);
    expect(overview).not.toMatch(/urgencyScore|leaderboard/i);
    expect(overview).not.toMatch(/employee score|ranking/i);
    expect(overview).toMatch(/overview-walkthrough-review-hint/);
  });

  it("Walkthroughs consumes observation deep-link from Overview", () => {
    const tab = readRepo("components/hub/tabs/WalkthroughsTab.tsx");
    expect(tab).toMatch(/useSearchParams/);
    expect(tab).toMatch(/observation/);
    expect(tab).toMatch(/openObservationById/);
  });

  it("follow-up inbox enrichment exposes place keys for Map links", () => {
    const domain = readRepo("lib/store-ops/walkthroughs.ts");
    expect(domain).toMatch(/department_id: obs\?\.department_id/);
    expect(domain).toMatch(/aisle: obs\?\.aisle/);
    expect(domain).toMatch(/bay: obs\?\.bay/);
  });

  it("preserves auto-stage OFF and MAP-004 specialty codes", () => {
    expect(STRICT_SECTION_OWNERSHIP_AUTO_STAGE).toBe(false);
    expect(NAMED_SPECIALTY_ZONE_CODES).toContain("CARPET-WALL");
  });
});
