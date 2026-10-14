/**
 * DEPTSYNC-MAP-004 — named specialty zones stay non-rotating by default.
 */

import { describe, expect, it } from "vitest";
import {
  isNamedSpecialtyZoneAisle,
  NAMED_SPECIALTY_ZONE_CODES,
  normalizeAisle,
} from "./aisle";
import { buildBulkLocationRows } from "./locations";
import { isEligibleRotationLocation } from "./location-eligibility";

describe("MAP-004 named specialty zone codes", () => {
  it("recognizes documented specialty codes and not numeric aisles", () => {
    for (const code of NAMED_SPECIALTY_ZONE_CODES) {
      expect(isNamedSpecialtyZoneAisle(code)).toBe(true);
      expect(isNamedSpecialtyZoneAisle(code.toLowerCase())).toBe(true);
    }
    expect(isNamedSpecialtyZoneAisle("41")).toBe(false);
    expect(isNamedSpecialtyZoneAisle("5")).toBe(false);
    expect(normalizeAisle("carpet-wall")).toBe("CARPET-WALL");
  });
});

describe("MAP-004 bulk generate defaults", () => {
  it("defaults CARPET-WALL / SHOW-* / CLOTHING to SHOWROOM_STACKOUT", () => {
    for (const aisle of ["CARPET-WALL", "SHOW-L", "SHOW-R", "CLOTHING"]) {
      const rows = buildBulkLocationRows({
        store_id: "store-1",
        department_id: "dept-1",
        aisle,
        start_bay: 1,
        end_bay: 1,
        types: ["SELLING", "TOPSTOCK"],
        bay_pattern: "odd",
      });
      expect(rows.length).toBe(2);
      expect(rows.every((r) => r.location_type === "SHOWROOM_STACKOUT")).toBe(
        true
      );
      expect(
        rows.every(
          (r) =>
            !isEligibleRotationLocation({
              is_active: true,
              location_type: r.location_type,
            })
        )
      ).toBe(true);
    }
  });

  it("keeps numeric aisles STANDARD (rotation-eligible) by default", () => {
    const rows = buildBulkLocationRows({
      store_id: "store-1",
      department_id: "dept-1",
      aisle: "41",
      start_bay: 1,
      end_bay: 1,
      types: ["SELLING"],
      bay_pattern: "odd",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.location_type).toBe("STANDARD");
    expect(
      isEligibleRotationLocation({
        is_active: true,
        location_type: rows[0]!.location_type,
      })
    ).toBe(true);
  });

  it("honors explicit location_type override on specialty codes", () => {
    const rows = buildBulkLocationRows({
      store_id: "store-1",
      department_id: "dept-1",
      aisle: "CARPET-WALL",
      start_bay: 1,
      end_bay: 1,
      types: ["SELLING"],
      bay_pattern: "odd",
      location_type: "STANDARD",
    });
    expect(rows[0]!.location_type).toBe("STANDARD");
  });
});
