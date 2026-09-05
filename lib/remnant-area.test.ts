import { describe, expect, it } from "vitest";
import {
  calculateSquareFeet,
  calculateSquareYards,
  composeRemnantArea,
} from "@/lib/calc";

describe("remnant area calculation", () => {
  it("uses width × length → sq ft → sq yd / 9", () => {
    // Formula: sqFt = widthFt × lengthFt; sqYd = sqFt / 9
    expect(calculateSquareFeet(12, 8.5)).toBe(102);
    expect(calculateSquareYards(102)).toBeCloseTo(11.333333, 5);

    const area = composeRemnantArea(12, 8.5);
    expect(area.sqFt).toBe(102);
    expect(area.sqYd).toBeCloseTo(11.333333, 5);
    expect(area.label).toBe("102.00 sq ft · 11.33 sq yd");
  });

  it("shows enter-length prompt until length is positive", () => {
    const empty = composeRemnantArea(12, 0);
    expect(empty.sqFt).toBe(0);
    expect(empty.label).toMatch(/Enter width & length/i);
  });
});
