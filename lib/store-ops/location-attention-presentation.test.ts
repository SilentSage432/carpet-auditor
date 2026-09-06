/**
 * SI-001B presentation helper tests — no SI recomputation.
 */

import { describe, expect, it } from "vitest";
import type { LocationAttentionSignal } from "./location-attention-pressure";
import {
  attentionActionabilityLabel,
  attentionCellMarker,
  attentionCellMarkerForPair,
  attentionCellMarkerForSignal,
  attentionConfidenceLabel,
  attentionReasonDisplayLines,
  attentionReasonLabel,
  attentionTierLabel,
  attentionUnavailableDimensionLabel,
  formatAttentionAsOf,
  indexAttentionSignalsByLocation,
  mapAttentionStatusLabel,
  sortAttentionReasonsForDisplay,
} from "./location-attention-presentation";

function signal(
  overrides: Partial<LocationAttentionSignal> &
    Pick<LocationAttentionSignal, "location_id" | "pressure">
): LocationAttentionSignal {
  return {
    operational_date: "2026-09-06",
    actionability: "ACTIONABLE",
    confidence: "HIGH",
    coverage_history: "PRESENT",
    reasons: [],
    evidence_count: 1,
    method: "location-attention-pressure-v1",
    method_version: 1,
    generated_at: "2026-09-06T06:00:00.000Z",
    ...overrides,
  };
}

describe("cell marker visibility", () => {
  it("hides NONE and LOW", () => {
    expect(attentionCellMarker("NONE")).toBeNull();
    expect(attentionCellMarker("LOW")).toBeNull();
  });

  it("shows MEDIUM and HIGH with compact labels", () => {
    expect(attentionCellMarker("MEDIUM")).toEqual({
      compact_label: "Med",
      a11y_suffix: "Current attention medium",
    });
    expect(attentionCellMarker("HIGH")).toEqual({
      compact_label: "High",
      a11y_suffix: "Current attention high",
    });
  });

  it("HIGH wins across bay pair", () => {
    expect(
      attentionCellMarkerForPair([
        signal({ location_id: "a", pressure: "MEDIUM" }),
        signal({ location_id: "b", pressure: "HIGH" }),
      ])?.compact_label
    ).toBe("High");
  });

  it("does not suppress HIGH for LOW confidence", () => {
    expect(
      attentionCellMarkerForSignal(
        signal({
          location_id: "a",
          pressure: "HIGH",
          confidence: "LOW",
        })
      )?.compact_label
    ).toBe("High");
  });
});

describe("labels", () => {
  it("maps tiers / confidence / actionability", () => {
    expect(attentionTierLabel("MEDIUM")).toBe("Medium");
    expect(attentionConfidenceLabel("LOW")).toBe("Low");
    expect(attentionActionabilityLabel("BLOCKED")).toBe("Blocked");
    expect(attentionActionabilityLabel("UNKNOWN")).toBe("Unclear");
  });

  it("humanizes reason codes without raw enums", () => {
    expect(attentionReasonLabel("COVERAGE_STALE")).toBe("Coverage is stale");
    expect(attentionReasonLabel("CARRYOVER_OPEN")).toBe(
      "Carryover remains open"
    );
    expect(attentionReasonLabel("BARRIER_OPEN")).toBe(
      "Barrier contributes to current attention"
    );
    expect(attentionReasonLabel("VERIFICATION_PENDING")).toBe(
      "Awaiting verification"
    );
    expect(attentionReasonLabel("CADENCE_OVERDUE")).toBe("Cadence is due");
    expect(attentionReasonLabel("NO_COVERAGE_HISTORY")).toBe(
      "No verified coverage history"
    );
  });

  it("seasonal CONTEXT vs MODIFY from SI effect — not code alone", () => {
    expect(
      attentionReasonLabel("SEASONAL_LOCATION_HIGH", "CONTEXT")
    ).toBe("Seasonal context is present");
    expect(
      attentionReasonLabel("SEASONAL_LOCATION_LOW", "CONTEXT")
    ).toBe("Seasonal context is present");
    expect(
      attentionReasonLabel("SEASONAL_DEPARTMENT_MEDIUM", "MODIFY")
    ).toBe("Seasonal context strengthened current attention");
    expect(
      attentionReasonLabel("SEASONAL_DEPARTMENT_HIGH", "MODIFY")
    ).toBe("Seasonal context strengthened current attention");
    expect(attentionReasonLabel("SEASONAL_LOCATION_NONE", "CONTEXT")).toBe(
      "Seasonal context marked not relevant"
    );
  });

  it("preserves CONTEXT and MODIFY seasonal lines; dedupes identical only", () => {
    const lines = attentionReasonDisplayLines([
      {
        code: "SEASONAL_DEPARTMENT_HIGH",
        effect: "MODIFY",
        evidence: { context_id: "a" },
      },
      {
        code: "SEASONAL_LOCATION_HIGH",
        effect: "MODIFY",
        evidence: { context_id: "a" },
      },
      {
        code: "SEASONAL_LOCATION_NONE",
        effect: "CONTEXT",
        evidence: { context_id: "b" },
      },
      {
        code: "COVERAGE_STALE",
        effect: "RAISE",
        evidence: {},
      },
    ]);
    expect(lines).toContain("Coverage is stale");
    expect(lines).toContain("Seasonal context strengthened current attention");
    expect(lines).toContain("Seasonal context marked not relevant");
    expect(
      lines.filter((l) => l.includes("strengthened")).length
    ).toBe(1);
  });

  it("orders reasons by presentation family", () => {
    const sorted = sortAttentionReasonsForDisplay([
      { code: "SEASONAL_LOCATION_HIGH", effect: "CONTEXT", evidence: {} },
      { code: "VERIFICATION_PENDING", effect: "RAISE", evidence: {} },
      { code: "BARRIER_OPEN", effect: "RAISE", evidence: { reason: "x" } },
    ]);
    expect(sorted.map((r) => r.code)).toEqual([
      "VERIFICATION_PENDING",
      "BARRIER_OPEN",
      "SEASONAL_LOCATION_HIGH",
    ]);
  });

  it("formats generated_at deterministically with explicit timezone", () => {
    const iso = "2026-09-06T18:42:00.000Z";
    expect(formatAttentionAsOf(iso, "America/Denver")).toBe("As of 12:42 PM");
    expect(formatAttentionAsOf(iso, "UTC")).toBe("As of 6:42 PM");
    // Same input → same output (no Date.now)
    expect(formatAttentionAsOf(iso, "America/Denver")).toBe(
      formatAttentionAsOf(iso, "America/Denver")
    );
  });
});

describe("status / index / as-of", () => {
  it("maps client status labels", () => {
    expect(mapAttentionStatusLabel("AVAILABLE")).toBeNull();
    expect(mapAttentionStatusLabel("LOADING")).toBeNull();
    expect(mapAttentionStatusLabel("UNAVAILABLE")).toMatch(/unavailable/i);
    expect(mapAttentionStatusLabel("NEEDS_DEPARTMENT")).toMatch(/Select a department/);
    expect(mapAttentionStatusLabel("DEGRADED")).toMatch(/partially/i);
  });

  it("indexes by location UUID", () => {
    const map = indexAttentionSignalsByLocation([
      signal({ location_id: "uuid-1", pressure: "MEDIUM" }),
    ]);
    expect(map.get("uuid-1")?.pressure).toBe("MEDIUM");
  });

  it("formats as-of without ticker", () => {
    expect(
      formatAttentionAsOf("2026-09-06T18:42:00.000Z", "America/Denver")
    ).toMatch(/^As of /);
  });

  it("humanizes unavailable dimensions", () => {
    expect(attentionUnavailableDimensionLabel("barriers")).toMatch(/Barrier/);
  });
});

describe("map composition source contracts", () => {
  it("MapTab fetches attention once per department and guards Master all", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const mapTab = await fs.readFile(
      path.resolve(__dirname, "../../components/hub/tabs/MapTab.tsx"),
      "utf8"
    );
    expect(mapTab).toMatch(/fetchLocationAttention/);
    expect(mapTab).toMatch(/NEEDS_DEPARTMENT/);
    expect(mapTab).toMatch(/nextAttentionRequestToken|isAttentionResponseCurrent/);
    expect(mapTab).toMatch(/AbortController/);
    expect(mapTab).not.toMatch(/attention heatmap|sortByAttention|rank_key/i);
  });

  it("grid marker is Focus chip; sheet places Current attention after seasonal", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const grid = await fs.readFile(
      path.resolve(__dirname, "../../components/admin/StoreLocationGrid.tsx"),
      "utf8"
    );
    const sheet = await fs.readFile(
      path.resolve(__dirname, "../../components/admin/WalkTheFloorSheet.tsx"),
      "utf8"
    );
    expect(grid).toMatch(/Focus/);
    expect(grid).toMatch(/bay-attention-marker/);
    expect(grid).not.toMatch(/AlertTriangle.*attentionMarker|attentionMarker.*AlertTriangle/);
    expect(sheet).toMatch(/walk-sheet-current-attention/);
    expect(sheet.indexOf("Seasonal context")).toBeLessThan(
      sheet.indexOf("Current attention")
    );
    expect(sheet.indexOf("Current attention")).toBeLessThan(
      sheet.indexOf("Walk the floor")
    );
  });
});
