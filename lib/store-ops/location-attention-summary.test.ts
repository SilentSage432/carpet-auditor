/**
 * SI-001C pure summary helper + Floor composition source contracts.
 */

import { describe, expect, it } from "vitest";
import type { LocationAttentionSignal } from "./location-attention-contract";
import {
  composeLocationAttentionSummary,
  emptyLocationAttentionSummary,
  formatAttentionTierCountLine,
  summarizeLocationAttentionResponse,
  type LocationAttentionSummary,
} from "./location-attention-summary";

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

describe("composeLocationAttentionSummary", () => {
  it("returns zeros for empty signals", () => {
    expect(composeLocationAttentionSummary([])).toEqual(
      emptyLocationAttentionSummary()
    );
  });

  it("counts all NONE", () => {
    const summary = composeLocationAttentionSummary([
      signal({ location_id: "a", pressure: "NONE" }),
      signal({ location_id: "b", pressure: "NONE" }),
    ]);
    expect(summary).toEqual({
      eligibleCount: 2,
      noneCount: 2,
      lowCount: 0,
      mediumCount: 0,
      highCount: 0,
      mediumOrHighCount: 0,
    });
  });

  it("counts all LOW", () => {
    const summary = composeLocationAttentionSummary([
      signal({ location_id: "a", pressure: "LOW" }),
      signal({ location_id: "b", pressure: "LOW" }),
      signal({ location_id: "c", pressure: "LOW" }),
    ]);
    expect(summary.lowCount).toBe(3);
    expect(summary.mediumOrHighCount).toBe(0);
    expect(summary.eligibleCount).toBe(3);
  });

  it("counts 1 MEDIUM", () => {
    const summary = composeLocationAttentionSummary([
      signal({ location_id: "a", pressure: "MEDIUM" }),
    ]);
    expect(summary.mediumCount).toBe(1);
    expect(summary.highCount).toBe(0);
    expect(summary.mediumOrHighCount).toBe(1);
  });

  it("counts 1 HIGH", () => {
    const summary = composeLocationAttentionSummary([
      signal({ location_id: "a", pressure: "HIGH" }),
    ]);
    expect(summary.highCount).toBe(1);
    expect(summary.mediumOrHighCount).toBe(1);
  });

  it("counts 2 HIGH + 4 MEDIUM among quiet tiers", () => {
    const summary = composeLocationAttentionSummary([
      signal({ location_id: "n1", pressure: "NONE" }),
      signal({ location_id: "l1", pressure: "LOW" }),
      signal({ location_id: "m1", pressure: "MEDIUM" }),
      signal({ location_id: "m2", pressure: "MEDIUM" }),
      signal({ location_id: "m3", pressure: "MEDIUM" }),
      signal({ location_id: "m4", pressure: "MEDIUM" }),
      signal({ location_id: "h1", pressure: "HIGH" }),
      signal({ location_id: "h2", pressure: "HIGH" }),
    ]);
    expect(summary).toEqual({
      eligibleCount: 8,
      noneCount: 1,
      lowCount: 1,
      mediumCount: 4,
      highCount: 2,
      mediumOrHighCount: 6,
    });
  });

  it("is order-independent", () => {
    const a = [
      signal({ location_id: "1", pressure: "HIGH" }),
      signal({ location_id: "2", pressure: "MEDIUM" }),
      signal({ location_id: "3", pressure: "LOW" }),
      signal({ location_id: "4", pressure: "NONE" }),
    ];
    const b = [...a].reverse();
    expect(composeLocationAttentionSummary(a)).toEqual(
      composeLocationAttentionSummary(b)
    );
  });

  it("ignores mixed confidence for counts", () => {
    const summary = composeLocationAttentionSummary([
      signal({
        location_id: "a",
        pressure: "HIGH",
        confidence: "LOW",
      }),
      signal({
        location_id: "b",
        pressure: "MEDIUM",
        confidence: "MEDIUM",
      }),
      signal({
        location_id: "c",
        pressure: "LOW",
        confidence: "HIGH",
      }),
    ]);
    expect(summary.highCount).toBe(1);
    expect(summary.mediumCount).toBe(1);
    expect(summary.lowCount).toBe(1);
    expect(summary.mediumOrHighCount).toBe(2);
  });

  it("ignores mixed actionability for counts", () => {
    const summary = composeLocationAttentionSummary([
      signal({
        location_id: "a",
        pressure: "HIGH",
        actionability: "BLOCKED",
      }),
      signal({
        location_id: "b",
        pressure: "MEDIUM",
        actionability: "UNKNOWN",
      }),
      signal({
        location_id: "c",
        pressure: "MEDIUM",
        actionability: "ACTIONABLE",
      }),
    ]);
    expect(summary.highCount).toBe(1);
    expect(summary.mediumCount).toBe(2);
    expect(summary.mediumOrHighCount).toBe(3);
  });

  it("does not mutate the input array or signals", () => {
    const signals = [
      signal({ location_id: "a", pressure: "HIGH" }),
      signal({ location_id: "b", pressure: "MEDIUM" }),
    ];
    const freeze = JSON.stringify(signals);
    composeLocationAttentionSummary(signals);
    expect(JSON.stringify(signals)).toBe(freeze);
  });

  it("summarizeLocationAttentionResponse uses signals only; degraded irrelevant", () => {
    const summary = summarizeLocationAttentionResponse({
      signals: [
        signal({ location_id: "a", pressure: "HIGH" }),
        signal({ location_id: "b", pressure: "MEDIUM" }),
        signal({ location_id: "c", pressure: "MEDIUM" }),
      ],
    });
    expect(summary.highCount).toBe(1);
    expect(summary.mediumCount).toBe(2);
    expect(summary.mediumOrHighCount).toBe(3);
  });

  it("exposes no score/rank/classification fields", () => {
    const summary: LocationAttentionSummary = composeLocationAttentionSummary([
      signal({ location_id: "a", pressure: "HIGH" }),
    ]);
    const keys = Object.keys(summary).sort();
    expect(keys).toEqual([
      "eligibleCount",
      "highCount",
      "lowCount",
      "mediumCount",
      "mediumOrHighCount",
      "noneCount",
    ]);
    expect(summary).not.toHaveProperty("score");
    expect(summary).not.toHaveProperty("rank");
    expect(summary).not.toHaveProperty("rank_key");
    expect(summary).not.toHaveProperty("priority");
    expect(summary).not.toHaveProperty("highest_present_tier");
    expect(summary).not.toHaveProperty("department_pressure");
  });
});

describe("formatAttentionTierCountLine", () => {
  it("formats High and Medium, omits zeros", () => {
    expect(
      formatAttentionTierCountLine({ highCount: 2, mediumCount: 4 })
    ).toBe("2 High · 4 Medium");
    expect(
      formatAttentionTierCountLine({ highCount: 1, mediumCount: 0 })
    ).toBe("1 High");
    expect(
      formatAttentionTierCountLine({ highCount: 0, mediumCount: 3 })
    ).toBe("3 Medium");
    expect(
      formatAttentionTierCountLine({ highCount: 0, mediumCount: 0 })
    ).toBeNull();
  });
});

describe("Floor SI-001C composition source contracts", () => {
  it("FloorTab owns independent SI fetch with race helpers; not shell/global", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const floorTab = await fs.readFile(
      path.resolve(__dirname, "../../components/hub/tabs/FloorTab.tsx"),
      "utf8"
    );
    const shell = await fs.readFile(
      path.resolve(__dirname, "../../components/hub/WorkflowTabShell.tsx"),
      "utf8"
    );
    const mapTab = await fs.readFile(
      path.resolve(__dirname, "../../components/hub/tabs/MapTab.tsx"),
      "utf8"
    );

    expect(floorTab).toMatch(/fetchLocationAttention/);
    expect(floorTab).toMatch(/nextAttentionRequestToken|isAttentionResponseCurrent/);
    expect(floorTab).toMatch(/AbortController/);
    expect(floorTab).toMatch(/NEEDS_DEPARTMENT/);
    expect(floorTab).toMatch(/composeLocationAttentionSummary|summarizeLocationAttentionResponse/);
    expect(floorTab).toMatch(/FloorAttentionSummary/);
    expect(floorTab).toMatch(/STORE_OPS_LOCATIONS_CHANGED_EVENT/);
    expect(floorTab).toMatch(/View on Map|\/admin\/store-map/);
    expect(floorTab).not.toMatch(/attention heatmap|sortByAttention|rank_key/i);
    expect(floorTab).not.toMatch(/top.?locations|highest.?pressure|department.?score/i);

    // Staging/shift refresh Floor ops only; SI uses a separate locations listener.
    expect(floorTab).toMatch(
      /function onFloorOpsReload\(\) \{\s*void reload\(specialist/
    );
    expect(floorTab).toMatch(
      /function onLocationsChanged\(\) \{\s*void reloadAttention\(deptId\)/
    );
    expect(floorTab).toMatch(
      /addEventListener\(\s*SUNDAY_AUDIT_EVENT,\s*onFloorOpsReload/
    );
    expect(floorTab).toMatch(
      /addEventListener\(\s*SHIFT_STATUS_EVENT,\s*onFloorOpsReload/
    );
    expect(floorTab).toMatch(
      /addEventListener\(\s*STORE_OPS_LOCATIONS_CHANGED_EVENT,\s*onLocationsChanged/
    );

    expect(shell).not.toMatch(/fetchLocationAttention|LocationAttention/);
    expect(mapTab).toMatch(/fetchLocationAttention/);
  });

  it("FloorAttentionSummary is props-only and does not list location identities", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const strip = await fs.readFile(
      path.resolve(
        __dirname,
        "../../components/store-ops/FloorAttentionSummary.tsx"
      ),
      "utf8"
    );
    expect(strip).toMatch(/Current attention/);
    expect(strip).toMatch(/No Medium\/High attention/);
    expect(strip).toMatch(/data-testid="floor-current-attention"/);
    expect(strip).not.toMatch(/fetchLocationAttention|useEffect/);
    expect(strip).not.toMatch(/location_id|aisle|bay_id/);
    expect(strip).not.toMatch(/Needs Attention/);
    expect(strip).not.toMatch(/AlertTriangle|Sparkles|Brain/);
  });

  it("barrier and verify-batch mutations emit location-changed for SI refresh", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const client = await fs.readFile(
      path.resolve(__dirname, "./client.ts"),
      "utf8"
    );
    const verifyBatch = client.slice(
      client.indexOf("export async function verifyWeeklyRotationBatch"),
      client.indexOf("export async function fetchVerificationQueue")
    );
    expect(verifyBatch).toMatch(/notifyStoreLocationsChanged/);
    const barriers = client.slice(
      client.indexOf("export async function reportRotationBarriers"),
      client.indexOf("export async function fetchExceptionSummary")
    );
    expect(barriers).toMatch(/notifyStoreLocationsChanged/);
    const generate = client.slice(
      client.indexOf("export async function generateRotations("),
      client.indexOf("export type GenerateRotationsBatchResult")
    );
    expect(generate).not.toMatch(/notifyStoreLocationsChanged/);
  });
});
