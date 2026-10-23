/**
 * DEPTSYNC-MAP-WALK-CUES-001 — aisle cue rules and read contracts.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  indexAssignedThisWeekBays,
  indexOpenFollowUpBays,
  mapBayWalkCues,
  mapWalkCueKey,
  type MapWalkAssignmentRotation,
} from "./map-walk-cues";

const root = join(__dirname, "../..");
const WEEK = "2026-W43";
const DEPT = "dept-floor";

function rotation(
  partial: Partial<MapWalkAssignmentRotation> & { id: string }
): MapWalkAssignmentRotation {
  return {
    assigned_week: WEEK,
    department_id: DEPT,
    store_locations: { department_id: DEPT, aisle: "12", bay: 4 },
    ...partial,
  };
}

function cues(input: {
  rotations?: MapWalkAssignmentRotation[];
  assignments?: Record<string, { specialist_id?: string | null }> | null;
  places?: Parameters<typeof indexOpenFollowUpBays>[0];
  week?: string;
  aisle?: string;
  bay?: number;
  departmentId?: string;
}) {
  const assignedKeys = indexAssignedThisWeekBays({
    operationalWeek: input.week ?? WEEK,
    rotations: input.rotations ?? [],
    assignments: input.assignments === undefined ? {} : input.assignments,
  });
  const followUpKeys = indexOpenFollowUpBays(
    input.places === undefined ? [] : input.places
  );
  return mapBayWalkCues({
    departmentId: input.departmentId ?? DEPT,
    aisle: input.aisle ?? "12",
    bay: input.bay ?? 4,
    assignedKeys,
    followUpKeys,
  });
}

describe("MAP-WALK-CUES-001 bay row cues", () => {
  it("shows neither cue when the bay has no assignment and no follow-up", () => {
    expect(
      cues({
        rotations: [rotation({ id: "rot-empty" })],
        assignments: {},
        places: [],
      })
    ).toEqual({ assignedThisWeek: false, openFollowUp: false });
  });

  it("shows an assignment cue from a persisted current-week assignee", () => {
    expect(
      cues({
        rotations: [rotation({ id: "rot-now" })],
        assignments: { "rot-now": { specialist_id: "spec-1" } },
      }).assignedThisWeek
    ).toBe(true);
  });

  it("ignores an assignment that belongs to a previous week", () => {
    const result = cues({
      week: WEEK,
      rotations: [
        rotation({ id: "rot-old", assigned_week: "2026-W42" }),
        rotation({ id: "rot-now", store_locations: { aisle: "12", bay: 5 } }),
      ],
      assignments: {
        "rot-old": { specialist_id: "spec-1" },
        "rot-now": { specialist_id: "spec-2" },
      },
      bay: 4,
    });
    expect(result.assignedThisWeek).toBe(false);
    expect(
      cues({
        rotations: [
          rotation({ id: "rot-old", assigned_week: "2026-W42" }),
        ],
        assignments: { "rot-old": { specialist_id: "spec-1" } },
        bay: 5,
        aisle: "12",
      }).assignedThisWeek
    ).toBe(false);
  });

  it("shows one follow-up cue for an open place and ignores a closed one", () => {
    expect(
      cues({
        places: [
          { department_id: DEPT, aisle: "12", bay: 4, status: "open" },
        ],
      }).openFollowUp
    ).toBe(true);
    expect(
      cues({
        places: [
          { department_id: DEPT, aisle: "12", bay: 4, status: "done" },
        ],
      }).openFollowUp
    ).toBe(false);
  });

  it("shows both cues together and collapses several open follow-ups to one bay", () => {
    const both = cues({
      rotations: [rotation({ id: "rot-both" })],
      assignments: { "rot-both": { specialist_id: "spec-1" } },
      places: [
        { department_id: DEPT, aisle: "12", bay: 4, status: "open" },
        { department_id: DEPT, aisle: "12", bay: 4, status: "open" },
      ],
    });
    expect(both).toEqual({ assignedThisWeek: true, openFollowUp: true });
    const keys = indexOpenFollowUpBays([
      { department_id: DEPT, aisle: "12", bay: 4, status: "open" },
      { department_id: DEPT, aisle: "12", bay: 4, status: "open" },
      { department_id: DEPT, aisle: "01", bay: 4, status: "open" },
      { department_id: DEPT, aisle: "1", bay: 4, status: "open" },
    ]);
    expect(keys?.size).toBe(2);
    expect(keys?.has(mapWalkCueKey({ departmentId: DEPT, aisle: "1", bay: 4 }))).toBe(
      true
    );
  });

  it("uses the operational week, not a rotation that merely exists", () => {
    const keys = indexAssignedThisWeekBays({
      operationalWeek: "2026-W44",
      rotations: [rotation({ id: "rot-now", assigned_week: WEEK })],
      assignments: { "rot-now": { specialist_id: "spec-1" } },
    });
    expect(keys?.size).toBe(0);
  });

  it("withholds cues when a read failed and skips partial place data", () => {
    expect(
      mapBayWalkCues({
        departmentId: DEPT,
        aisle: "12",
        bay: 4,
        assignedKeys: null,
        followUpKeys: null,
      })
    ).toEqual({ assignedThisWeek: false, openFollowUp: false });
    expect(
      indexAssignedThisWeekBays({
        operationalWeek: WEEK,
        rotations: [rotation({ id: "rot-now" })],
        assignments: null,
      })
    ).toBeNull();
    const partial = indexOpenFollowUpBays([
      { department_id: "", aisle: "12", bay: 4, status: "open" },
      { department_id: DEPT, aisle: "", bay: 4, status: "open" },
      { department_id: DEPT, aisle: "12", bay: Number.NaN, status: "open" },
    ]);
    expect(partial?.size).toBe(0);
    const missingFace = indexAssignedThisWeekBays({
      operationalWeek: WEEK,
      rotations: [
        rotation({ id: "rot-gap", store_locations: null }),
        rotation({ id: "rot-old", superseded_at: "2026-10-01" }),
      ],
      assignments: {
        "rot-gap": { specialist_id: "spec-1" },
        "rot-old": { specialist_id: "spec-1" },
      },
    });
    expect(missingFace?.size).toBe(0);
  });

  it("does not infer an assignment from an empty specialist id", () => {
    expect(
      cues({
        rotations: [rotation({ id: "rot-clear" })],
        assignments: { "rot-clear": { specialist_id: "" } },
      }).assignedThisWeek
    ).toBe(false);
  });

  it("keeps department places apart and shares one physical bay across faces", () => {
    const keys = indexAssignedThisWeekBays({
      operationalWeek: WEEK,
      rotations: [
        rotation({
          id: "rot-a",
          department_id: "dept-a",
          store_locations: { department_id: "dept-a", aisle: "12", bay: 4 },
        }),
        rotation({
          id: "rot-b",
          department_id: "dept-b",
          store_locations: { department_id: "dept-b", aisle: "12", bay: 4 },
        }),
        rotation({
          id: "rot-top",
          department_id: "dept-a",
          store_locations: { department_id: "dept-a", aisle: "12", bay: 4 },
        }),
      ],
      assignments: {
        "rot-a": { specialist_id: "spec-1" },
        "rot-top": { specialist_id: "spec-2" },
      },
    });
    expect(keys?.has(mapWalkCueKey({ departmentId: "dept-a", aisle: "12", bay: 4 }))).toBe(
      true
    );
    expect(keys?.has(mapWalkCueKey({ departmentId: "dept-b", aisle: "12", bay: 4 }))).toBe(
      false
    );
    expect(keys?.size).toBe(1);
  });
});

describe("MAP-WALK-CUES-001 read and navigation contracts", () => {
  const map = readFileSync(
    join(root, "components/hub/tabs/MapTab.tsx"),
    "utf8"
  );
  const grid = readFileSync(
    join(root, "components/admin/StoreLocationGrid.tsx"),
    "utf8"
  );
  const cuesSrc = readFileSync(
    join(root, "lib/store-ops/map-walk-cues.ts"),
    "utf8"
  );
  const walks = readFileSync(
    join(root, "lib/store-ops/walkthroughs.ts"),
    "utf8"
  );
  const route = readFileSync(
    join(root, "app/api/walkthroughs/route.ts"),
    "utf8"
  );
  const sunday = readFileSync(
    join(root, "lib/store-ops/sunday-audit.ts"),
    "utf8"
  );
  const readiness = readFileSync(
    join(root, "lib/store-ops/map-readiness.ts"),
    "utf8"
  );
  const cron = readFileSync(join(root, "vercel.json"), "utf8");
  const latch = readFileSync(
    join(root, "lib/store-ops/authoritative-week-cycle.ts"),
    "utf8"
  );

  it("loads assignment and follow-up cues in the existing map batch", () => {
    expect(map.match(/fetchStoreWeekSundayAssignments\(/g)?.length).toBe(1);
    expect(map.match(/fetchWalkthroughOpenPlaces\(/g)?.length).toBe(1);
    expect(map).not.toMatch(/fetchMapBayContext/);
    expect(map).not.toMatch(/\/api\/store-locations\/bay-context/);
    expect(map).toMatch(/fetchThisWeekRotations\(member\)/);
    expect(grid).toMatch(/onOpenWalk/);
    expect(grid).toMatch(/WalkTheFloorSheet/);
    expect(grid).toMatch(/data-testid="map-bay-row"/);
    expect(grid).toMatch(/data-testid="map-cue-assigned"/);
    expect(grid).toMatch(/data-testid="map-cue-follow-up"/);
    expect(grid).not.toMatch(/>Unassigned</);
  });

  it("keeps readiness tones independent of the new chips", () => {
    expect(readiness).toMatch(/This week/);
    expect(readiness).not.toMatch(/map-walk-cues/);
    expect(grid).toMatch(/classifyMapReadiness/);
  });

  it("reads open follow-ups by store in two queries and rejects missing actors", () => {
    const fn = walks.slice(
      walks.indexOf("export async function listOpenFollowUpPlaces"),
      walks.indexOf("export async function listWalkthroughInbox")
    );
    expect(fn).toMatch(/\.eq\("store_id", storeId\)/);
    expect(fn).toMatch(/\.eq\("status", "open"\)/);
    expect(fn).toMatch(/observation_id, status/);
    expect(fn).toMatch(/id, department_id, aisle, bay/);
    expect(fn).not.toMatch(/action_text|insert\(|update\(|upsert\(/);
    expect(fn).not.toMatch(/select\([^)]*body/);
    expect(route.indexOf("requireStoreOpsActor")).toBeLessThan(
      route.indexOf("open-places")
    );
    expect(route).toMatch(/StoreOpsAuthError/);
    expect(route).toMatch(/status: err\.status/);
    expect(route).toMatch(/listWalkthroughInbox/);
  });

  it("scopes the week assignment read to the store and does not write", () => {
    const fn = sunday.slice(
      sunday.indexOf("export async function fetchStoreWeekSundayAssignments"),
      sunday.indexOf("export function getSundayAssignments")
    );
    expect(fn).toMatch(/week_starting/);
    expect(fn).toMatch(/store_number/);
    expect(fn).not.toMatch(/\.eq\("department"|\.in\("department"/);
    expect(fn).not.toMatch(/insert\(|update\(|upsert\(|delete\(/);
    expect(cuesSrc).not.toMatch(
      /section-week-coverage|primary_owner|insert\(|update\(|upsert\(/
    );
    expect(walks).not.toMatch(/sunday_bay_assignments/);
    expect(walks).not.toMatch(/weekly_rotations/);
  });

  it("does not change the Sunday cron or the publication latch", () => {
    expect(cron).toMatch(/"schedule": "0 12 \* \* 0"/);
    expect(latch).toMatch(
      /export const WEEKLY_ROTATION_AUTO_PUBLISH: boolean = true/
    );
  });
});
