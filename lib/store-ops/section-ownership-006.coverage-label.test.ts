/**
 * DEPTSYNC-SECTION-OWNERSHIP-006 — This Week temporary coverage labels.
 * Presentation only. Does not assign, publish, or replace the permanent owner.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BaySectionLookup } from "./operational-sections";
import { physicalBayKey } from "./physical-bay";
import { previewCoverageCapacityImpact } from "./section-week-coverage";
import type { SundayAssignmentMap } from "./sunday-audit";
import {
  composeThisWeekOwnership,
  temporaryCoverageLines,
  type ThisWeekCoverageRecord,
} from "./this-week-ownership";
import type { WeeklyRotationWithLocation } from "./types";
import { WEEKLY_ROTATION_AUTO_PUBLISH } from "./authoritative-week-cycle";

function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function section(
  id: string,
  name: string,
  ownerId: string | null,
  ownerName: string | null,
  departmentId = "flooring"
): BaySectionLookup {
  return {
    section_id: id,
    section_name: name,
    department_id: departmentId,
    primary_owner_specialist_id: ownerId,
    primary_owner_name: ownerName,
    is_active: true,
  };
}

function rotation(
  id: string,
  aisle: string,
  bay: number,
  departmentId = "flooring"
): WeeklyRotationWithLocation {
  return {
    id,
    store_id: "s1",
    department_id: departmentId,
    location_id: `loc-${id}`,
    assigned_week: "2026-W44",
    is_completed: false,
    verification_status: "PENDING",
    store_locations: {
      id: `loc-${id}`,
      store_id: "s1",
      department_id: departmentId,
      aisle,
      bay,
      type: "SELLING",
      status: "PENDING",
      is_active: true,
      location_type: "STANDARD",
    },
  } as WeeklyRotationWithLocation;
}

function assign(id: string, name: string) {
  return {
    specialist_id: id,
    specialist_name: name,
    assigned_at: "2026-10-22T00:00:00Z",
  };
}

function key(aisle: string, bay: number, departmentId = "flooring"): string {
  return physicalBayKey({ department_id: departmentId, aisle, bay });
}

function planFor(input: {
  rotations: WeeklyRotationWithLocation[];
  assignments: SundayAssignmentMap;
  sections: Map<string, BaySectionLookup>;
  coverage?: readonly ThisWeekCoverageRecord[] | null;
  weekLabel?: string | null;
}) {
  return composeThisWeekOwnership({
    rotations: input.rotations,
    assignments: input.assignments,
    baySectionByKey: input.sections,
    weekCoverage: input.coverage,
    weekLabel: input.weekLabel === undefined ? "2026-W44" : input.weekLabel,
  });
}

describe("SECTION-OWNERSHIP-006 coverage labels", () => {
  const nateSection = section("sec-b", "Section B", "nate", "Nate");
  const tracySection = section("sec-d", "Section D", "tracy", "Tracy");

  it("leaves a normal assignment unlabeled when the week has no coverage", () => {
    const plan = planFor({
      rotations: [rotation("r1", "12", 1)],
      assignments: { r1: assign("tracy", "Tracy") },
      sections: new Map([[key("12", 1), nateSection]]),
      coverage: [],
    });
    const bay = plan.owners[0]!.bays[0]!;
    expect(bay.coveragePresentation.kind).toBe("none");
    expect(temporaryCoverageLines(bay.coveragePresentation, "Tracy")).toBeNull();
    expect(bay.section?.primary_owner_specialist_id).toBe("nate");
    expect(plan.owners[0]!.specialistName).toBe("Tracy");
  });

  it("names the assigned cover and the permanent owner", () => {
    const plan = planFor({
      rotations: [rotation("r1", "12", 1)],
      assignments: { r1: assign("tracy", "Tracy") },
      sections: new Map([[key("12", 1), nateSection]]),
      coverage: [
        {
          section_id: "sec-b",
          week_label: "2026-W44",
          covering_specialist_id: "tracy",
          covering_specialist_name: "Tracy",
        },
      ],
    });
    const bay = plan.owners[0]!.bays[0]!;
    expect(bay.coveragePresentation).toEqual({
      kind: "covering",
      assignedName: "Tracy",
      permanentOwnerName: "Nate",
    });
    expect(temporaryCoverageLines(bay.coveragePresentation, "Tracy")).toEqual([
      "Assigned to Tracy",
      "Permanent owner Nate",
      "Covering this week",
    ]);
    expect(bay.section?.primary_owner_specialist_id).toBe("nate");
  });

  it("keeps a different assignee from being called the covering associate", () => {
    const plan = planFor({
      rotations: [rotation("r1", "12", 1)],
      assignments: { r1: assign("nick", "Nick") },
      sections: new Map([[key("12", 1), nateSection]]),
      coverage: [
        {
          section_id: "sec-b",
          week_label: "2026-W44",
          covering_specialist_id: "tracy",
          covering_specialist_name: "Tracy",
        },
      ],
    });
    const bay = plan.owners[0]!.bays[0]!;
    expect(plan.owners[0]!.specialistId).toBe("nick");
    expect(bay.coveragePresentation.kind).toBe("assigned_while_other_covers");
    const lines = temporaryCoverageLines(bay.coveragePresentation, "Nick");
    expect(lines).toEqual([
      "Assigned to Nick",
      "Permanent owner Nate",
      "Tracy covering this week",
    ]);
    expect(lines?.join(" ")).not.toMatch(/Nick covering/i);
  });

  it("does not treat coverage as an assignment for an unowned bay", () => {
    const plan = planFor({
      rotations: [rotation("r1", "12", 1)],
      assignments: {},
      sections: new Map([[key("12", 1), nateSection]]),
      coverage: [
        {
          section_id: "sec-b",
          week_label: "2026-W44",
          covering_specialist_id: "tracy",
          covering_specialist_name: "Tracy",
        },
      ],
    });
    expect(plan.owners).toHaveLength(0);
    expect(plan.unownedBays[0]!.coveragePresentation.kind).toBe("none");
    expect(plan.unownedBays[0]!.isAssigned).toBe(false);
  });

  it("lets Tracy cover Section B without relabeling her own Section D", () => {
    const plan = planFor({
      rotations: [rotation("own", "20", 1), rotation("cover", "12", 2)],
      assignments: {
        own: assign("tracy", "Tracy"),
        cover: assign("tracy", "Tracy"),
      },
      sections: new Map([
        [key("20", 1), tracySection],
        [key("12", 2), nateSection],
      ]),
      coverage: [
        {
          section_id: "sec-b",
          week_label: "2026-W44",
          covering_specialist_id: "tracy",
          covering_specialist_name: "Tracy",
        },
      ],
    });
    const bays = plan.owners[0]!.bays;
    const own = bays.find((bay) => bay.rotation.id === "own")!;
    const cover = bays.find((bay) => bay.rotation.id === "cover")!;
    expect(own.coveragePresentation.kind).toBe("none");
    expect(own.section?.primary_owner_name).toBe("Tracy");
    expect(cover.coveragePresentation.kind).toBe("covering");
    expect(cover.section?.primary_owner_name).toBe("Nate");
    const impact = previewCoverageCapacityImpact({
      covering_specialist_id: "tracy",
      covering_specialist_name: "Tracy",
      approved_capacity: 3,
      permanent_section_ids: ["sec-d"],
      covered_section_ids: ["sec-b"],
    });
    expect(impact.approved_capacity).toBe(3);
    expect(impact.section_pool_count).toBe(2);
    expect(impact.note).toMatch(/does not multiply capacity/);
    expect(bays).toHaveLength(2);
  });

  it("applies coverage only to the selected week", () => {
    const coverage: ThisWeekCoverageRecord[] = [
      {
        section_id: "sec-b",
        week_label: "2026-W43",
        covering_specialist_id: "tracy",
        covering_specialist_name: "Tracy",
      },
    ];
    const shared = {
      rotations: [rotation("r1", "12", 1)],
      assignments: { r1: assign("tracy", "Tracy") },
      sections: new Map([[key("12", 1), nateSection]]),
      coverage,
    };
    const current = planFor({ ...shared, weekLabel: "2026-W44" });
    const prior = planFor({ ...shared, weekLabel: "2026-W43" });
    expect(current.owners[0]!.bays[0]!.coveragePresentation.kind).toBe("none");
    expect(prior.owners[0]!.bays[0]!.coveragePresentation.kind).toBe("covering");
    expect(prior.owners[0]!.bays[0]!.section?.primary_owner_specialist_id).toBe(
      "nate"
    );
  });

  it("withholds a label when coverage is ambiguous or the cover name is missing", () => {
    const ambiguous = planFor({
      rotations: [rotation("r1", "12", 1)],
      assignments: { r1: assign("tracy", "Tracy") },
      sections: new Map([[key("12", 1), nateSection]]),
      coverage: [
        {
          section_id: "sec-b",
          week_label: "2026-W44",
          covering_specialist_id: "tracy",
          covering_specialist_name: "Tracy",
        },
        {
          section_id: "sec-b",
          week_label: "2026-W44",
          covering_specialist_id: "nick",
          covering_specialist_name: "Nick",
        },
      ],
    });
    expect(ambiguous.owners[0]!.bays[0]!.coveragePresentation).toEqual({
      kind: "withheld",
      reason: "ambiguous_coverage",
    });
    expect(ambiguous.owners[0]!.specialistId).toBe("tracy");

    const unnamed = planFor({
      rotations: [rotation("r1", "12", 1)],
      assignments: { r1: assign("nick", "Nick") },
      sections: new Map([[key("12", 1), nateSection]]),
      coverage: [
        {
          section_id: "sec-b",
          week_label: "2026-W44",
          covering_specialist_id: "tracy",
          covering_specialist_name: " ",
        },
      ],
    });
    expect(unnamed.owners[0]!.bays[0]!.coveragePresentation).toEqual({
      kind: "withheld",
      reason: "missing_cover_name",
    });
    expect(
      temporaryCoverageLines(
        unnamed.owners[0]!.bays[0]!.coveragePresentation,
        "Nick"
      )
    ).toBeNull();
  });

  it("does not invent a permanent owner name when the section has none", () => {
    const plan = planFor({
      rotations: [rotation("r1", "12", 1)],
      assignments: { r1: assign("tracy", "Tracy") },
      sections: new Map([
        [key("12", 1), section("sec-b", "Section B", null, null)],
      ]),
      coverage: [
        {
          section_id: "sec-b",
          week_label: "2026-W44",
          covering_specialist_id: "tracy",
          covering_specialist_name: "Tracy",
        },
      ],
    });
    expect(temporaryCoverageLines(plan.owners[0]!.bays[0]!.coveragePresentation, "Tracy")).toEqual([
      "Assigned to Tracy",
      "Permanent owner unavailable",
      "Covering this week",
    ]);
  });

  it("ignores coverage for a different section", () => {
    const plan = planFor({
      rotations: [rotation("r1", "12", 1, "decor")],
      assignments: { r1: assign("tracy", "Tracy") },
      sections: new Map([
        [key("12", 1, "decor"), section("sec-decor", "Decor", "nate", "Nate", "decor")],
      ]),
      coverage: [
        {
          section_id: "sec-b",
          week_label: "2026-W44",
          covering_specialist_id: "tracy",
          covering_specialist_name: "Tracy",
        },
      ],
    });
    expect(plan.owners[0]!.bays[0]!.coveragePresentation.kind).toBe("none");
  });

  it("does not call coverage a change of ownership when the cover is already the permanent owner", () => {
    const plan = planFor({
      rotations: [rotation("r1", "20", 1)],
      assignments: { r1: assign("tracy", "Tracy") },
      sections: new Map([[key("20", 1), tracySection]]),
      coverage: [
        {
          section_id: "sec-d",
          week_label: "2026-W44",
          covering_specialist_id: "tracy",
          covering_specialist_name: "Tracy",
        },
      ],
    });
    expect(plan.owners[0]!.bays[0]!.coveragePresentation.kind).toBe("none");
    expect(plan.owners[0]!.bays[0]!.section?.primary_owner_specialist_id).toBe(
      "tracy"
    );
  });

  it("keeps This Week interactions and refuses a second ownership resolver", () => {
    const board = readRepo("components/store-ops/ThisWeekOwnershipBoard.tsx");
    const composer = readRepo("lib/store-ops/this-week-ownership.ts");
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    const route = readRepo("app/api/section-week-coverage/route.ts");
    const coverage = readRepo("lib/store-ops/section-week-coverage.ts");
    const cron = readRepo("vercel.json");

    expect(board).toMatch(/completeRotation/);
    expect(board).toMatch(/buildMapBayFocusHref/);
    expect(board).toMatch(/zebraHandoffEvidenceLabel/);
    expect(board).toMatch(/flagForDownstock/);
    expect(board).toMatch(/temporaryCoverageLines/);

    expect(composer).not.toMatch(/applyWeekCoverageToBaySectionLookups/);
    expect(composer).not.toMatch(/establishSectionWeekCoverage/);
    expect(composer).not.toMatch(/operational_section_events/);
    expect(floor).toMatch(/fetchSectionWeekCoverage/);
    expect(floor).not.toMatch(/establishSectionWeekCoverageClient/);
    expect(floor).not.toMatch(/applyWeekCoverageToBaySectionLookups/);

    expect(route).toMatch(/requireStoreOpsActor/);
    expect(route).toMatch(/requireSupervisorOrAdmin/);
    expect(route).toMatch(/resolveStoreByNumber\(supabase, actor\.storeNumber\)/);
    expect(coverage).toMatch(/\.is\("revoked_at", null\)/);
    expect(WEEKLY_ROTATION_AUTO_PUBLISH).toBe(true);
    expect(cron).toMatch(/"schedule": "0 12 \* \* 0"/);
  });
});
