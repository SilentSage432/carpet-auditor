/**
 * SO-003 default-behavior equivalence (no coverage → identical to permanent).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { selectSectionBalancedPhysicalBayCoverage } from "./section-balanced-stage";
import { applyWeekCoverageToBaySectionLookups } from "./section-week-coverage";
import type { BaySectionLookup } from "./operational-sections";
import type { StoreLocation } from "./types";

const DEPT = "dept-floor";
const bayKey = (a: string, b: number) => `${DEPT}|${a}|${b}`;
const lookup = (sid: string, owner: string): BaySectionLookup => ({
  section_id: sid,
  section_name: sid,
  primary_owner_specialist_id: owner,
  primary_owner_name: owner,
  department_id: DEPT,
  is_active: true,
});
const loc = (aisle: string, bay: number, completedAt: string): StoreLocation =>
  ({
    id: `${aisle}-${bay}`,
    store_id: "s",
    store_number: "2587",
    department_id: DEPT,
    aisle,
    bay,
    type: "SELLING",
    location_type: "STANDARD",
    is_active: true,
    status: "PENDING",
    last_completed_at: completedAt,
  }) as StoreLocation;

function planFp(baySectionByKey: Map<string, BaySectionLookup>) {
  const pending = [
    loc("7", 1, "2026-08-01T12:00:00.000Z"),
    loc("7", 2, "2026-08-02T12:00:00.000Z"),
    loc("7", 3, "2026-08-03T12:00:00.000Z"),
    loc("41", 1, "2026-08-04T12:00:00.000Z"),
    loc("41", 2, "2026-08-05T12:00:00.000Z"),
    loc("41", 3, "2026-08-06T12:00:00.000Z"),
    loc("39", 1, "2026-08-07T12:00:00.000Z"),
    loc("39", 2, "2026-08-08T12:00:00.000Z"),
    loc("39", 3, "2026-08-09T12:00:00.000Z"),
    loc("43", 1, "2026-08-10T12:00:00.000Z"),
    loc("43", 2, "2026-08-11T12:00:00.000Z"),
    loc("43", 3, "2026-08-12T12:00:00.000Z"),
  ];
  const result = selectSectionBalancedPhysicalBayCoverage({
    pending,
    carried: [],
    slots: [
      { specialist_id: "tyson", specialist_name: "Tyson", capacity: 3 },
      { specialist_id: "nate", specialist_name: "Nate", capacity: 3 },
      { specialist_id: "nick", specialist_name: "Nick", capacity: 3 },
      { specialist_id: "tracy", specialist_name: "Tracy", capacity: 3 },
    ],
    baySectionByKey,
  });
  const norm = result.selected
    .map((s) => {
      const owner =
        baySectionByKey.get(s.key)?.primary_owner_specialist_id ?? "?";
      return `${s.key}|${owner}`;
    })
    .sort()
    .join(";");
  return {
    fp: createHash("sha256").update(norm).digest("hex").slice(0, 16),
    count: result.selected.length,
    byOwner: Object.fromEntries(
      ["tyson", "nate", "nick", "tracy"].map((id) => [
        id,
        result.selected.filter(
          (s) =>
            baySectionByKey.get(s.key)?.primary_owner_specialist_id === id
        ).length,
      ])
    ),
  };
}

describe("SO003 default-behavior equivalence", () => {
  const permanent = new Map<string, BaySectionLookup>([
    [bayKey("7", 1), lookup("sec-a", "tyson")],
    [bayKey("7", 2), lookup("sec-a", "tyson")],
    [bayKey("7", 3), lookup("sec-a", "tyson")],
    [bayKey("39", 1), lookup("sec-b", "nate")],
    [bayKey("39", 2), lookup("sec-b", "nate")],
    [bayKey("39", 3), lookup("sec-b", "nate")],
    [bayKey("43", 1), lookup("sec-c", "nick")],
    [bayKey("43", 2), lookup("sec-c", "nick")],
    [bayKey("43", 3), lookup("sec-c", "nick")],
    [bayKey("41", 1), lookup("sec-d", "tracy")],
    [bayKey("41", 2), lookup("sec-d", "tracy")],
    [bayKey("41", 3), lookup("sec-d", "tracy")],
  ]);

  it("empty coverage overlay matches permanent-only planning fingerprint", () => {
    const a = planFp(permanent);
    const b = planFp(applyWeekCoverageToBaySectionLookups(permanent, new Map()));
    expect(b.fp).toBe(a.fp);
    expect(a.count).toBe(12);
    expect(a.byOwner).toEqual({ tyson: 3, nate: 3, nick: 3, tracy: 3 });
  });
});
