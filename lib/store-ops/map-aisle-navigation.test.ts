/**
 * RD-2 — aisle → bay navigation composition.
 */

import { describe, expect, it } from "vitest";
import {
  buildMapBayPairs,
  composeMapAisleIndex,
  filterAisleIndexByQuery,
  formatMapAisleLabel,
  isMapBayPairActive,
} from "./map-aisle-navigation";
import type { Department, StoreLocation } from "./types";

function loc(
  partial: Partial<StoreLocation> &
    Pick<StoreLocation, "id" | "department_id" | "aisle" | "bay" | "type">
): StoreLocation {
  return {
    store_id: "s1",
    status: "PENDING",
    is_active: true,
    cycle_number: 1,
    last_completed_at: null,
    location_type: "STANDARD",
    ...partial,
  } as StoreLocation;
}

const depts: Department[] = [
  {
    id: "d1",
    store_id: "s1",
    name: "Flooring",
    code: "flooring",
    weekly_bay_target: 12,
    is_active: true,
  },
  {
    id: "d2",
    store_id: "s1",
    name: "Home Decor",
    code: "home_decor",
    weekly_bay_target: 12,
    is_active: true,
  },
];

describe("map-aisle-navigation", () => {
  it("builds selling/topstock bay pairs sorted by bay", () => {
    const pairs = buildMapBayPairs([
      loc({
        id: "t",
        department_id: "d1",
        aisle: "12",
        bay: 3,
        type: "TOPSTOCK",
      }),
      loc({
        id: "s",
        department_id: "d1",
        aisle: "12",
        bay: 1,
        type: "SELLING",
      }),
      loc({
        id: "s3",
        department_id: "d1",
        aisle: "12",
        bay: 3,
        type: "SELLING",
      }),
    ]);
    expect(pairs.map((p) => p.bay)).toEqual([1, 3]);
    expect(pairs[1]?.selling?.id).toBe("s3");
    expect(pairs[1]?.topstock?.id).toBe("t");
  });

  it("composes aisle-first index without department accordion", () => {
    const index = composeMapAisleIndex({
      locations: [
        loc({
          id: "a",
          department_id: "d1",
          aisle: "bw",
          bay: 1,
          type: "SELLING",
        }),
        loc({
          id: "b",
          department_id: "d1",
          aisle: "BW",
          bay: 1,
          type: "TOPSTOCK",
        }),
        loc({
          id: "c",
          department_id: "d1",
          aisle: "12",
          bay: 2,
          type: "SELLING",
        }),
      ],
      departments: depts,
    });
    expect(index.map((e) => e.aisle)).toEqual(["12", "BW"]);
    expect(index[0]?.physicalBayCount).toBe(1);
    expect(index[1]?.physicalBayCount).toBe(1);
    expect(index.every((e) => e.key.includes(":"))).toBe(true);
  });

  it("hides inactive bays unless showRetired", () => {
    const locations = [
      loc({
        id: "active",
        department_id: "d1",
        aisle: "41",
        bay: 1,
        type: "SELLING",
        is_active: true,
      }),
      loc({
        id: "retired",
        department_id: "d1",
        aisle: "41",
        bay: 3,
        type: "SELLING",
        is_active: false,
      }),
      loc({
        id: "gone-aisle",
        department_id: "d1",
        aisle: "99",
        bay: 1,
        type: "SELLING",
        is_active: false,
      }),
    ];
    const activeOnly = composeMapAisleIndex({ locations, departments: depts });
    expect(activeOnly).toHaveLength(1);
    expect(activeOnly[0]?.bays.map((b) => b.bay)).toEqual([1]);

    const withRetired = composeMapAisleIndex({
      locations,
      departments: depts,
      showRetired: true,
    });
    expect(withRetired.map((e) => e.aisle).sort()).toEqual(["41", "99"]);
    const aisle41 = withRetired.find((e) => e.aisle === "41");
    expect(aisle41?.inactiveBayCount).toBe(1);
    expect(aisle41?.activeBayCount).toBe(1);
  });

  it("labels colliding aisle codes with department name", () => {
    const index = composeMapAisleIndex({
      locations: [
        loc({
          id: "1",
          department_id: "d1",
          aisle: "12",
          bay: 1,
          type: "SELLING",
        }),
        loc({
          id: "2",
          department_id: "d2",
          aisle: "12",
          bay: 1,
          type: "SELLING",
        }),
      ],
      departments: depts,
    });
    expect(index).toHaveLength(2);
    expect(index.every((e) => e.aisleCodeCollides)).toBe(true);
    expect(formatMapAisleLabel(index[0]!)).toContain("·");
  });

  it("filters aisle index by query", () => {
    const index = composeMapAisleIndex({
      locations: [
        loc({
          id: "1",
          department_id: "d1",
          aisle: "BW",
          bay: 1,
          type: "SELLING",
        }),
        loc({
          id: "2",
          department_id: "d1",
          aisle: "12",
          bay: 1,
          type: "SELLING",
        }),
      ],
      departments: depts,
    });
    expect(filterAisleIndexByQuery(index, "bw")).toHaveLength(1);
    expect(filterAisleIndexByQuery(index, "")).toHaveLength(2);
  });

  it("treats a bay active when any surface is active", () => {
    expect(
      isMapBayPairActive({
        bay: 1,
        selling: loc({
          id: "s",
          department_id: "d1",
          aisle: "1",
          bay: 1,
          type: "SELLING",
          is_active: false,
        }),
        topstock: loc({
          id: "t",
          department_id: "d1",
          aisle: "1",
          bay: 1,
          type: "TOPSTOCK",
          is_active: true,
        }),
      })
    ).toBe(true);
  });
});
